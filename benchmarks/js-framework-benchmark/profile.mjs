// Script time per cycle of clicks, from a CPU profile, for implementations in the benchmark's
// layout: the measure the performance audits use, steadier than run.mjs's wall clock (which is
// mostly layout and paint, and moves 10 to 20% between runs).
//
//   node profile.mjs [--cycles 8] [--rounds 5]                     # frameworks/keyed/zubra here
//   node profile.mjs --compare <benchmark-checkout> vanillajs solid  # beside others (built there)
//   node profile.mjs --also <dir> …                                # and other builds of Zubra's
//                                                                   # implementation (its layout)
//
// Each scenario is a cycle of clicks (each followed by a frame), run three times to warm up, then
// `--cycles` times under Chromium's sampling profiler (100 µs). Script time is the samples' self
// time without (idle), (program) (style, layout, paint) and (garbage collector), which is reported
// apart. Scenarios and implementations are interleaved over `--rounds` rounds, the order reversed
// on odd rounds, so a machine's drift lands on all of them alike; the table gives the median and
// the range. On a busy two-core machine, differences under about 2 ms a cycle are noise.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const CYCLES = Number(option('--cycles', 8));
const ROUNDS = Number(option('--rounds', 5));
const compare = option('--compare');
const listAfter = (flag) => (args.includes(flag) ? args.slice(args.indexOf(flag) + (flag === '--compare' ? 2 : 1)).filter((arg) => !arg.startsWith('--')) : []);
const implementations = [
  { name: 'zubra', dir: join(here, 'frameworks/keyed/zubra') },
  ...listAfter('--also').map((dir) => ({ name: basename(resolve(dir)), dir: resolve(dir) })),
  ...listAfter('--compare').map((name) => ({ name, dir: join(resolve(compare), 'frameworks/keyed', name) })),
];
const cssRoot = compare ? resolve(compare) : null;

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
  const [, name, ...rest] = path.split('/');
  let file = name === 'css' && cssRoot ? join(cssRoot, path) : join(implementations.find((i) => i.name === name)?.dir ?? '/nonexistent', ...rest);
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

const scenarios = {
  'create 1k, clear': ['#run', '#clear'],
  'create 1k twice (replace), clear': ['#run', '#run', '#clear'],
  'create 1k, append 1k, clear': ['#run', '#add', '#clear'],
  'create 1k, update ×10, clear': ['#run', ...Array(10).fill('#update'), '#clear'],
  'create 1k, select ×10, clear': ['#run', 'select', '#clear'],
  'create 1k, swap ×10, clear': ['#run', ...Array(10).fill('#swaprows'), '#clear'],
  'create 1k, remove ×10, clear': ['#run', 'remove', '#clear'],
};
const root = `(document.querySelector('main-element')?.shadowRoot ?? document)`;
const click = (selector) => `${root}.querySelector(${JSON.stringify(selector)}).click()`;

async function measure(name, steps) {
  const page = await browser.newPage();
  await page.goto(`${origin}/${name}/`);
  await page.waitForFunction(`!!${root}.querySelector('#run')`);
  const cdp = await page.context().newCDPSession(page);
  const cycle = async () => {
    for (const step of steps) {
      if (step === 'select') {
        for (let i = 1; i <= 10; i++) await page.evaluate(click(`tbody>tr:nth-of-type(${i * 7})>td:nth-of-type(2)>a`));
      } else if (step === 'remove') {
        for (let i = 0; i < 10; i++) await page.evaluate(click('tbody>tr:nth-of-type(5)>td:nth-of-type(3)>a'));
      } else await page.evaluate(click(step));
      await page.evaluate('new Promise((done) => requestAnimationFrame(() => setTimeout(done)))');
    }
  };
  for (let i = 0; i < 3; i++) await cycle();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Profiler.start');
  for (let i = 0; i < CYCLES; i++) await cycle();
  const { profile } = await cdp.send('Profiler.stop');
  await page.close();
  const names = new Map(profile.nodes.map((node) => [node.id, node.callFrame.functionName]));
  let script = 0;
  let gc = 0;
  profile.samples.forEach((id, i) => {
    const ms = profile.timeDeltas[i] / 1000;
    const fn = names.get(id);
    if (fn === '(garbage collector)') gc += ms;
    else if (fn !== '(idle)' && fn !== '(program)') script += ms;
  });
  return { script: script / CYCLES, gc: gc / CYCLES };
}

const browser = await chromium.launch();
const samples = {};
for (let round = 0; round < ROUNDS; round++) {
  for (const [scenario, steps] of Object.entries(scenarios)) {
    for (const { name } of round % 2 ? [...implementations].reverse() : implementations) {
      ((samples[name] ??= {})[scenario] ??= []).push(await measure(name, steps));
    }
  }
}
await browser.close();
server.close();

const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1];
const cell = (list, key) => {
  const values = list.map((sample) => sample[key]);
  return `${median(values).toFixed(1)} (${Math.min(...values).toFixed(1)} to ${Math.max(...values).toFixed(1)})`;
};
const names = implementations.map((i) => i.name);
console.log(`Script time per cycle, ms: median of ${ROUNDS} rounds of ${CYCLES} cycles (range).\n`);
console.log(`| Cycle | ${names.join(' | ')} |`);
console.log(`|---|${names.map(() => '---:').join('|')}|`);
for (const scenario of Object.keys(scenarios)) console.log(`| ${scenario} | ${names.map((n) => cell(samples[n][scenario], 'script')).join(' | ')} |`);
console.log(`| GC, create 1k and clear | ${names.map((n) => cell(samples[n]['create 1k, clear'], 'gc')).join(' | ')} |`);
