// Measures every build of the slice the same way, and writes results.json and RESULTS.md.
//   node measure.mjs [zubra nextjs sveltekit nuxt]
// Each build is started with `node` directly (no npm), in production mode, on a fresh in-memory
// shop. See docs/compare/RULES.md for what is measured and why.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { cpus, totalmem } from 'node:os';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import autocannon from 'autocannon';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const here = import.meta.dirname;
const slice = join(here, '..');
const PORT = 3150;
const CONTROL = 3151;
const BASE = `http://localhost:${PORT}`;
// The server runs on CPU 0 and this script (with the load generator and browsers) on CPU 1, so they
// don't compete. measure.mjs pins itself when started with PIN=1.
const PIN = process.env.PIN === '1';
const RUNS = { build: 3, start: 5, lighthouse: 3, load: 3 };
const LOAD_SECONDS = Number(process.env.LOAD_SECONDS ?? 10);

const node = process.execPath;
const BUILDS = {
  zubra: { build: null, outputs: [], start: ['server.js'], runtime: ['node_modules'] },
  'zubra-stream': { build: null, outputs: [], start: ['server.js'], runtime: ['node_modules'] },
  nextjs: { build: ['node_modules/next/dist/bin/next', 'build'], outputs: ['.next'], start: ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], runtime: ['.next', 'node_modules'] },
  sveltekit: { build: ['node_modules/vite/bin/vite.js', 'build'], outputs: ['.svelte-kit', 'build'], start: ['build'], runtime: ['build'] },
  nuxt: { build: ['node_modules/nuxt/bin/nuxt.mjs', 'build'], outputs: ['.nuxt', '.output'], start: ['.output/server/index.mjs'], runtime: ['.output'] },
  // Tuned by the author for production, not yet reviewed: see each folder's diff against its default.
  'nextjs-tuned': { build: ['../measure/run-script.mjs', 'build'], outputs: ['.next'], start: ['.next/standalone/compare/slice/nextjs-tuned/server.js'], runtime: ['.next/standalone'] },
  'nuxt-tuned': { build: ['node_modules/nuxt/bin/nuxt.mjs', 'build'], outputs: ['.nuxt', '.output'], start: ['.output/server/index.mjs'], runtime: ['.output'] },
  // Web component libraries, each on a plain Node server like the Zubra build.
  lit: { build: ['node_modules/esbuild/bin/esbuild', 'client.js', '--bundle', '--minify', '--format=esm', '--outfile=dist/client.js'], outputs: ['dist'], start: ['server.js'], runtime: ['node_modules', 'dist'] },
  enhance: { build: ['node_modules/esbuild/bin/esbuild', 'client.js', '--bundle', '--minify', '--format=esm', '--outfile=dist/client.js'], outputs: ['dist'], start: ['server.js'], runtime: ['node_modules/@enhance', 'node_modules/counter-slice-backend', 'dist'] },
  stencil: { build: ['node_modules/@stencil/core/bin/stencil', 'build'], outputs: ['www', 'hydrate', '.stencil'], start: ['server.js'], runtime: ['www', 'hydrate'] },
  fast: { build: ['../measure/webui-build.mjs', '--plugin=fast-v3'], outputs: ['dist'], start: ['server.js'], runtime: ['node_modules/@microsoft/webui', 'node_modules/@microsoft/webui-linux-x64', 'dist'] },
  webui: { build: ['../measure/webui-build.mjs', '--plugin=webui', '--dom=light'], outputs: ['dist'], start: ['server.js'], runtime: ['node_modules/@microsoft/webui', 'node_modules/@microsoft/webui-linux-x64', 'dist'] },
};
const OWN = new Set(['.js', '.mjs', '.ts', '.tsx', '.vue', '.svelte', '.zb', '.html']);
const SKIP = new Set(['copy-static.mjs', 'node_modules', '.next', '.svelte-kit', 'build', '.nuxt', '.output', 'dist', 'www', 'hydrate', '.stencil']);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const kb = (bytes) => Math.round((bytes / 1024) * 10) / 10;
const duSize = (path) => (existsSync(path) ? Number(execFileSync('du', ['-sk', path]).toString().split('\t')[0]) * 1024 : 0);

/** Non-blank, non-comment lines in the build's own source (configs included, lockfiles not). */
function lines(dir) {
  const files = [];
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      if (SKIP.has(name)) continue;
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (OWN.has(extname(name))) files.push(path);
    }
  };
  walk(dir);
  let total = 0;
  const perFile = {};
  for (const file of files) {
    let inBlock = null;
    let count = 0;
    for (let line of readFileSync(file, 'utf8').split('\n')) {
      line = line.trim();
      if (inBlock) {
        const end = line.indexOf(inBlock);
        if (end < 0) continue;
        line = line.slice(end + inBlock.length).trim();
        inBlock = null;
      }
      if (line.startsWith('/*') || line.startsWith('<!--')) {
        const close = line.startsWith('/*') ? '*/' : '-->';
        const end = line.indexOf(close, 2);
        if (end < 0) {
          inBlock = close;
          continue;
        }
        line = line.slice(end + close.length).trim();
      }
      if (!line || line.startsWith('//')) continue;
      count += 1;
    }
    perFile[relative(dir, file)] = count;
    total += count;
  }
  return { total, files: perFile };
}

function dependencies(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const direct = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((name) => name !== 'counter-slice-backend');
  const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  const installed = Object.keys(lock.packages).filter((path) => path.startsWith('node_modules/') && !lock.packages[path].link);
  return { direct: direct.length, installed: installed.length, nodeModules: duSize(join(dir, 'node_modules')) };
}

/** A native binary (esbuild, webui) runs as itself; a script runs through node. */
const native = (path) => {
  try {
    return readFileSync(path).subarray(0, 4).toString('latin1') === '\x7fELF';
  } catch {
    return false;
  }
};

function run(dir, args, env = {}) {
  const [command, ...rest] = native(join(dir, args[0])) ? [join(dir, args[0]), ...args.slice(1)] : [node, ...args];
  return new Promise((resolve, reject) => {
    const child = spawn(command, rest, { cwd: dir, env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', NUXT_TELEMETRY_DISABLED: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (out += chunk));
    child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}: ${out.slice(-800)}`))));
  });
}

async function start(dir, spec) {
  const began = performance.now();
  const [command, args] = PIN ? ['taskset', ['-c', '0', node, ...spec.start]] : [node, spec.start];
  const child = spawn(command, args, { cwd: dir, env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), ORIGIN: BASE, HOSTNAME: '127.0.0.1', SLICE_CONTROL_PORT: String(CONTROL), NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => (errors += chunk));
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited: ${errors.slice(-800)}`);
    try {
      if ((await fetch(`${BASE}/`)).status === 200) break;
    } catch {}
    if (performance.now() - began > 60_000) throw new Error('server did not answer in 60 s');
    await sleep(10);
  }
  return { child, ready: performance.now() - began };
}
const stop = async (child) => {
  child.kill('SIGTERM');
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await sleep(20);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  await sleep(200);
};
/** The server's own process: under taskset it's the child's child (taskset execs, so it's the same pid). */
const rss = (pid) => Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]) * 1024;

/** Every script and stylesheet the menu page loads, raw and gzipped here (the same way for all). */
async function payload(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const seen = [];
  page.on('response', async (response) => {
    const type = response.request().resourceType();
    try {
      const body = await response.body();
      seen.push({ url: response.url().replace(BASE, ''), type, raw: body.length, gzip: gzipSync(body).length });
    } catch {}
  });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await sleep(300);
  await context.close();
  const scripts = seen.filter((one) => one.type === 'script');
  const sum = (list, key) => list.reduce((total, one) => total + one[key], 0);
  const doc = seen.find((one) => one.type === 'document');
  return {
    scripts: scripts.length,
    jsRaw: sum(scripts, 'raw'),
    jsGzip: sum(scripts, 'gzip'),
    htmlRaw: doc?.raw ?? 0,
    htmlGzip: doc?.gzip ?? 0,
    requests: seen.filter((one) => one.type !== 'eventsource' && !one.url.startsWith('/live') && !one.url.startsWith('/_zb/sync')).length,
    files: scripts.map(({ url, raw, gzip }) => ({ url, raw, gzip })),
  };
}

async function accessibility(browser) {
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  const found = {};
  await page.goto('/');
  found.menu = (await new AxeBuilder({ page }).analyze()).violations.map((one) => `${one.id} (${one.nodes.length})`);
  await page.getByLabel('How many Country sourdough').fill('2');
  await page.locator('li.item', { hasText: 'Country sourdough' }).getByRole('button', { name: 'Add' }).click();
  await page.waitForURL(/done=/);
  await page.goto('/order');
  found.bag = (await new AxeBuilder({ page }).analyze()).violations.map((one) => `${one.id} (${one.nodes.length})`);
  await context.close();
  return found;
}

async function lighthouseRuns() {
  const results = [];
  for (let i = 0; i < RUNS.lighthouse; i++) {
    const chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
    try {
      const { lhr } = await lighthouse(`${BASE}/`, { port: chrome.port, output: 'json', logLevel: 'error', onlyCategories: ['performance'] }, {
        extends: 'lighthouse:default',
        // Lighthouse's mobile profile, with the CPU slowed 6× instead of 4× so small pages separate.
        settings: { throttling: { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675, cpuSlowdownMultiplier: 6 } },
      });
      results.push({ score: lhr.categories.performance.score * 100, lcp: lhr.audits['largest-contentful-paint'].numericValue, tbt: lhr.audits['total-blocking-time'].numericValue, fcp: lhr.audits['first-contentful-paint'].numericValue });
    } finally {
      await chrome.kill();
    }
  }
  return { score: median(results.map((r) => r.score)), lcp: median(results.map((r) => r.lcp)), tbt: median(results.map((r) => r.tbt)), fcp: median(results.map((r) => r.fcp)), runs: results };
}

async function load(pid) {
  const runs = [];
  for (let i = 0; i < RUNS.load; i++) {
    let peak = 0;
    const sampler = setInterval(() => (peak = Math.max(peak, rss(pid))), 100);
    const result = await autocannon({ url: `${BASE}/`, connections: 50, duration: LOAD_SECONDS });
    clearInterval(sampler);
    runs.push({ rps: result.requests.average, p50: result.latency.p50, p975: result.latency.p97_5, p99: result.latency.p99, errors: result.errors + result.non2xx, peakRss: peak });
  }
  return { rps: median(runs.map((r) => r.rps)), p50: median(runs.map((r) => r.p50)), p975: median(runs.map((r) => r.p975)), errors: runs.reduce((t, r) => t + r.errors, 0), peakRss: median(runs.map((r) => r.peakRss)), runs };
}

const kitchen = (path) => fetch(`http://127.0.0.1:${CONTROL}${path}`, { method: 'POST' }).then((res) => res.json());

/**
 * Milliseconds from the kitchen's change (POST to the control port) to an open page showing it.
 * The page polls its own text every 4 ms (the browser's timer floor), reading shadow roots too,
 * and stamps the moment with Date.now(); both clocks are this machine's.
 */
/** In the page: resolves with Date.now() once the page's text (shadow roots included) matches `want`. */
function watchText({ want, giveUp }) {
  const deep = (node) => (node.shadowRoot ? deep(node.shadowRoot) : '') + [...node.childNodes].map((child) => (child.nodeType === 3 ? child.textContent : child.nodeType === 1 || child.nodeType === 11 ? deep(child) : '')).join('');
  const re = new RegExp(want);
  const until = Date.now() + giveUp;
  return new Promise((resolve) => {
    const look = () => (re.test(deep(document.body).replace(/\s+/g, ' ')) ? resolve(Date.now()) : Date.now() > until ? resolve(null) : setTimeout(look, 4));
    look();
  });
}
/** In the page: resolves with Date.now() once `count` order steps are marked done (shadow roots included). */
function watchSteps({ count, giveUp }) {
  const done = (root) => [...root.querySelectorAll('ol.steps li.done'), ...[...root.querySelectorAll('*')].flatMap((el) => (el.shadowRoot ? done(el.shadowRoot) : []))];
  const until = Date.now() + giveUp;
  return new Promise((resolve) => {
    const look = () => (done(document).length >= count ? resolve(Date.now()) : Date.now() > until ? resolve(null) : setTimeout(look, 4));
    look();
  });
}
/** Time from `act` to the page seeing it; null (shown as "no update") if it never does in 5 s. */
async function timed(page, watcher, arg, act) {
  const seen = page.evaluate(watcher, { ...arg, giveUp: 5000 });
  const sent = Date.now();
  await act();
  const at = await seen;
  return at === null ? null : at - sent;
}

async function updateSpeed(browser) {
  const menu = [];
  const context = await browser.newContext({ baseURL: BASE });
  const page = await context.newPage();
  await kitchen('/stock?item=apple-hand-pie&left=20');
  await page.goto('/');
  await sleep(1000); // the live connection open
  for (let i = 0; i < 12; i++) {
    const left = 19 - i;
    menu.push(await timed(page, watchText, { want: `Apple hand pie[^$]*\\$5\\.50[^A-Z]*\\b${left} left` }, () => kitchen(`/stock?item=apple-hand-pie&left=${left}`)));
    await sleep(150 + Math.random() * 250); // land at different points of any polling interval
  }
  await kitchen('/stock?item=apple-hand-pie&left=4');
  // The order page: place orders through the real pages, then move each along three steps.
  const order = [];
  for (let n = 0; n < 4; n++) {
    await page.goto('/');
    await page.getByLabel('How many Drip coffee').fill('1');
    await page.locator('li.item', { hasText: 'Drip coffee' }).getByRole('button', { name: 'Add' }).click();
    await page.waitForURL(/done=/);
    await page.goto('/order');
    const open = (await page.getByLabel('When you’ll come by').locator('option:not([disabled])').allInnerTexts()).filter((one) => /\d/.test(one));
    await page.getByLabel('When you’ll come by').selectOption({ label: open.at(-1 - n) });
    await page.getByRole('button', { name: 'Set the time' }).click();
    await page.goto('/checkout');
    await page.getByLabel('Name', { exact: true }).fill('Speed Test');
    await page.getByLabel('Email', { exact: true }).fill('speed@example.com');
    await page.getByLabel('Card number').fill('4242 4242 4242 4242');
    await page.getByRole('button', { name: /^Place order/ }).click();
    await page.waitForURL(/\/orders\//);
    const key = new URL(page.url()).pathname.split('/').pop();
    await sleep(1000);
    for (const [to, count] of [['making', 2], ['ready', 3], ['picked-up', 4]]) {
      order.push(await timed(page, watchSteps, { count }, () => kitchen(`/advance?key=${key}&to=${to}`)));
      await sleep(150 + Math.random() * 250);
    }
  }
  await context.close();
  const summary = (list) => {
    const seen = list.filter((one) => one !== null);
    if (seen.length < list.length) return { median: null, p90: null, missed: list.length - seen.length, samples: list };
    return { median: median(seen), p90: [...seen].sort((a, b) => a - b)[Math.floor(seen.length * 0.9)], samples: list };
  };
  return { menu: summary(menu), order: summary(order) };
}

/**
 * A slow phone: the browser's CPU slowed 6× (Lighthouse's mobile profile uses 4×). The menu's load
 * event, and a click on Add until the "Added to your order." notice shows. Medians of 5.
 */
async function slowDevice(browser) {
  const loads = [];
  const adds = [];
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
    await page.goto('/', { waitUntil: 'load' });
    loads.push(await page.evaluate(() => performance.getEntriesByType('navigation')[0].loadEventEnd));
    await sleep(500);
    await page.getByLabel('How many Butter croissant').fill('1');
    const began = Date.now();
    await page.locator('li.item', { hasText: 'Butter croissant' }).getByRole('button', { name: 'Add' }).click();
    await page.locator('.notice', { hasText: 'Added to your order.' }).waitFor();
    adds.push(Date.now() - began);
    await context.close();
  }
  return { load: median(loads), add: median(adds), loads, adds };
}

/** The contract, against the running server: how many of its tests pass. */
function contract() {
  return new Promise((resolve) => {
    const child = spawn(node, ['--test', join(slice, 'contract', 'slice.contract.mjs')], { env: { ...process.env, BASE, CONTROL: String(CONTROL) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('exit', () => {
      const pass = Number(/^ℹ pass (\d+)/m.exec(out)?.[1] ?? 0);
      const failed = [...out.matchAll(/^✖ (S\d[^(]*)/gm)].map((m) => m[1].trim()).filter((one, i, all) => all.indexOf(one) === i);
      resolve({ pass, total: pass + Number(/^ℹ fail (\d+)/m.exec(out)?.[1] ?? 0), failed });
    });
  });
}

async function measure(name) {
  const dir = join(slice, name);
  const spec = BUILDS[name];
  const result = { name, lines: lines(dir), dependencies: dependencies(dir) };
  console.log(`\n== ${name}`);

  const builds = [];
  if (spec.build) {
    for (let i = 0; i < RUNS.build; i++) {
      for (const out of spec.outputs) rmSync(join(dir, out), { recursive: true, force: true });
      const began = performance.now();
      await run(dir, spec.build);
      builds.push(performance.now() - began);
    }
  }
  result.build = { ms: builds.length ? median(builds) : 0, runs: builds };
  result.runtimeSize = spec.runtime.reduce((total, path) => total + duSize(join(dir, path)), 0);
  console.log(`  build ${Math.round(result.build.ms)} ms, ${result.lines.total} lines`);

  const readies = [];
  for (let i = 0; i < RUNS.start; i++) {
    const { child, ready } = await start(dir, spec);
    readies.push(ready);
    await stop(child);
  }
  result.start = { ms: median(readies), runs: readies };

  const { child } = await start(dir, spec);
  try {
    await fetch(`${BASE}/`);
    await sleep(2000);
    result.idleRss = rss(child.pid);
    const browser = await chromium.launch();
    try {
      result.payload = await payload(browser);
      result.accessibility = await accessibility(browser);
      result.updates = await updateSpeed(browser);
      result.slow = await slowDevice(browser);
      console.log(`  updates: menu ${result.updates.menu.median} ms, order ${result.updates.order.median} ms; slow load ${Math.round(result.slow.load)} ms, add ${result.slow.add} ms`);
    } finally {
      await browser.close();
    }
    console.log(`  JS ${kb(result.payload.jsGzip)} KB gzip in ${result.payload.scripts} files; a11y ${JSON.stringify(result.accessibility)}`);
    result.lighthouse = await lighthouseRuns();
    console.log(`  lighthouse ${result.lighthouse.score} LCP ${Math.round(result.lighthouse.lcp)} TBT ${Math.round(result.lighthouse.tbt)}`);
    result.load = await load(child.pid);
    result.contractRun = await contract();
    result.contract = `${result.contractRun.pass}${result.contractRun.failed.length ? ` (fails ${result.contractRun.failed.map((one) => one.split(' ')[0]).join(', ')})` : ''}`;
    console.log(`  contract ${result.contract}`);
    console.log(`  ${Math.round(result.load.rps)} req/s, p97.5 ${result.load.p975} ms`);
  } finally {
    await stop(child);
  }
  return result;
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(BUILDS);
const machine = { pinned: PIN, cpus: cpus().length, cpu: cpus()[0]?.model, memoryGb: Math.round(totalmem() / 2 ** 30), node: process.version, date: new Date().toISOString(), loadSeconds: LOAD_SECONDS, runs: RUNS };
const results = [];
for (const name of names) results.push(await measure(name));

const versions = Object.fromEntries(names.map((name) => [name, JSON.parse(readFileSync(join(slice, name, 'package.json'), 'utf8'))]));
writeFileSync(join(here, 'results.json'), `${JSON.stringify({ machine, versions: Object.fromEntries(Object.entries(versions).map(([n, p]) => [n, { ...p.dependencies, ...p.devDependencies }])), results }, null, 2)}\n`);

const GROUPS = [
  ['Zubra', ['zubra', 'zubra-stream']],
  ['Web component libraries, each on a plain Node server', ['lit', 'enhance', 'stencil', 'fast', 'webui']],
  ['App frameworks (tuned: set up for production by the author, not yet reviewed)', ['sveltekit', 'nextjs', 'nextjs-tuned', 'nuxt', 'nuxt-tuned']],
];
const ROWS = [
  ['Contract (of 11)', (r) => r.contract ?? 'see log'],
  ['JavaScript on the menu, gzip (KB)', (r) => kb(r.payload.jsGzip)],
  ['Script files on the menu', (r) => r.payload.scripts],
  ['Menu HTML, gzip (KB)', (r) => kb(r.payload.htmlGzip)],
  ['Update shows on the menu, median / p90 (ms)', (r) => (r.updates.menu.missed ? `${r.updates.menu.missed} of 12 never showed` : `${r.updates.menu.median} / ${r.updates.menu.p90}`)],
  ['Update shows on the order page, median / p90 (ms)', (r) => (r.updates.order.missed ? `${r.updates.order.missed} of 12 never showed` : `${r.updates.order.median} / ${r.updates.order.p90}`)],
  ['Lighthouse, CPU 6× slower', (r) => Math.round(r.lighthouse.score)],
  ['Total blocking time, CPU 6× slower (ms)', (r) => Math.round(r.lighthouse.tbt)],
  ['Menu load event, CPU 6× slower (ms)', (r) => Math.round(r.slow.load)],
  ['Add to bag until the notice shows, CPU 6× slower (ms)', (r) => r.slow.add],
  ['Lines of own code', (r) => r.lines.total],
  ['Direct dependencies', (r) => r.dependencies.direct],
  ['Packages installed', (r) => r.dependencies.installed],
  ['node_modules (MB)', (r) => Math.round(r.dependencies.nodeModules / 2 ** 20)],
  ['What runs in production (MB)', (r) => Math.round(r.runtimeSize / 2 ** 20)],
  ['Build (s)', (r) => (r.build.ms ? (r.build.ms / 1000).toFixed(1) : 'none')],
  ['Start to first page (ms)', (r) => Math.round(r.start.ms)],
  ['Memory idle (MB)', (r) => Math.round(r.idleRss / 2 ** 20)],
  ['Memory under load (MB)', (r) => Math.round(r.load.peakRss / 2 ** 20)],
  ['Menu pages per second', (r) => Math.round(r.load.rps)],
  ['Latency p50 / p97.5 (ms)', (r) => `${r.load.p50} / ${r.load.p975}`],
  ['Failed requests under load', (r) => r.load.errors],
  ['Accessibility violations (menu, bag)', (r) => [...r.accessibility.menu, ...r.accessibility.bag].join(', ') || 'none'],
];
const byName = Object.fromEntries(results.map((r) => [r.name, r]));
const table = (names) => {
  const list = names.map((name) => byName[name]).filter(Boolean);
  if (!list.length) return '';
  return [`| | ${list.map((r) => r.name).join(' | ')} |`, `| --- | ${list.map(() => '---:').join(' | ')} |`, ...ROWS.map(([label, fn]) => `| ${label} | ${list.map(fn).join(' | ')} |`)].join('\n');
};
const md = `# Slice results

Measured ${machine.date.slice(0, 10)} on ${machine.cpus} × ${machine.cpu}, ${machine.memoryGb} GB, Node ${machine.node}${PIN ? ', the server pinned to one CPU and the load generator and browsers to the other' : ''}.
Medians of ${RUNS.build} builds, ${RUNS.start} starts, ${RUNS.lighthouse} Lighthouse runs, ${RUNS.load} load runs of ${LOAD_SECONDS} s at 50 connections, 12 menu updates and 12 order updates, and 5 slow-device runs.
Raw figures: \`results.json\`. What each measure means and how it's taken: \`measure.mjs\`.

${GROUPS.map(([title, names]) => `## ${title}\n\n${table(names)}`).filter((part) => part.includes('|')).join('\n\n')}
`;
writeFileSync(join(here, 'RESULTS.md'), md);
console.log(`\n${md}`);
