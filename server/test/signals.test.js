// Signals mode (experimental): `engine: 'signals'` serves @zubra/runtime's TC39 engine
// (`signal-tc39.js`) as its engine (`signal.js`), file by file, in place of Zubra's own.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createZubra } from '../src/index.js';
import { createZubra as createEdge } from '../src/edge.js';
import { buildApp, buildRuntime } from '../src/build.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'components');
// One of signal-impl.js's messages: only the TC39 engine has it.
const TC39_ENGINE = 'Called watch/unwatch without a Computed or State argument';
const layout = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
const get = (zubra, url) => {
  const answer = { status: 404, body: '' };
  zubra.handle({ url }, { writeHead: (status) => (answer.status = status), end: (body) => (answer.body = String(body)) });
  return answer;
};

let browser;
const servers = [];
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  for (const server of servers) server.close();
});

test("engine: 'signals' serves the TC39 engine as the runtime's, file by file in production too", () => {
  for (const production of [false, true]) {
    const plain = createZubra({ components, production });
    const signals = createZubra({ components, production, engine: 'signals' });
    assert.equal(get(signals, '/_zubra/runtime/signal.js').status, 200);
    assert.match(get(signals, '/_zubra/runtime/signal.js').body, /from\s*["']\.\/signal-impl\.js/, `production: ${production}`);
    assert.doesNotMatch(get(plain, '/_zubra/runtime/signal.js').body, /from\s*["']\.\/signal-impl\.js/, `production: ${production}`);
    const page = signals.page();
    page.render('count-stepper', { value: 1 });
    const html = page.finish(layout(''));
    assert.doesNotMatch(html, /runtime\/zubra\.js/, 'not the one-file build, which holds Zubra\'s engine');
  }
});

test('a page counts on both engines', async () => {
  for (const signals of [false, true]) {
    const zubra = createZubra({ components, production: true, engine: signals ? 'signals' : 'zubra' });
    const server = createServer((req, res) => {
      if (zubra.handle(req, res)) return;
      const page = zubra.page();
      const stepper = page.render('count-stepper', { value: 1 });
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(page.finish(layout(stepper)));
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, resolve));
    const tab = await browser.newPage();
    const errors = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    await tab.goto(`http://localhost:${server.address().port}/`);
    await tab.waitForFunction(() => customElements.get('count-stepper'));
    const engine = await tab.evaluate(async () => (await import('/_zubra/runtime/signal.js')).Signal.subtle.Watcher !== undefined);
    assert.equal(engine, signals, `signals: ${signals}`);
    await tab.click('count-stepper .more');
    await tab.waitForFunction(() => document.querySelector('count-stepper').shadowRoot.querySelector('output').textContent === '2');
    assert.deepEqual(errors, []);
    await tab.close();
  }
});

test('a built runtime is built with the same engine as the server that sends it', async () => {
  const built = await buildRuntime({ components, engine: 'signals' });
  assert.equal(built.signals, true);
  assert.ok(built.code.includes(TC39_ENGINE), 'the TC39 engine is in it');
  const plain = await buildRuntime({ components });
  assert.equal(plain.signals, undefined);
  assert.ok(!plain.code.includes(TC39_ENGINE));
  assert.throws(() => createZubra({ components, production: true, runtime: built }), /built with engine: 'signals', and this server has engine: 'zubra'/);
  assert.throws(() => createZubra({ components, production: true, engine: 'signals', runtime: plain }), /built with engine: 'zubra', and this server has engine: 'signals'/);
  createZubra({ components, production: true, engine: 'signals', runtime: built });
});

test("signals: true, 6.0.0-rc.0's name, is still engine: 'signals', and development says to write that", async () => {
  const said = [];
  const warn = (message) => said.push(message);
  const zubra = createZubra({ components, production: false, signals: true, warn });
  assert.match(get(zubra, '/_zubra/runtime/signal.js').body, /from\s*["']\.\/signal-impl\.js/);
  assert.deepEqual(said.filter((message) => /signals: true/.test(message)), ["@zubra/server: signals: true is engine: 'signals' since 6.0; write engine: 'signals'"]);
  // In production it says nothing.
  said.length = 0;
  createZubra({ components, production: true, signals: true, warn });
  assert.deepEqual(said.filter((message) => /signals/.test(message)), []);
  // buildRuntime() says so too, once, and builds the TC39 engine.
  const built = await buildRuntime({ components, signals: true, warn });
  assert.equal(built.signals, true);
  assert.deepEqual(said, ["@zubra/server/build: signals: true is engine: 'signals' since 6.0; write engine: 'signals'"]);
  // At the edge, where a server is in production unless it says otherwise.
  said.length = 0;
  assert.throws(() => createEdge({ compiler: {}, signals: true, bundle: true, production: false, warn }), /engine: 'signals' can't go with bundle: true/);
  assert.equal(said.length, 1);
});

test('an engine that is neither, a signals that isn\'t a boolean, or both disagreeing, is an error naming the two engines', async () => {
  for (const create of [(options) => createZubra({ components, ...options }), (options) => createEdge({ compiler: {}, ...options })]) {
    assert.throws(() => create({ engine: 'tc39' }), /engine: 'tc39' isn't an engine; it is 'zubra' \(the default\) or 'signals'/);
    assert.throws(() => create({ engine: true }), /engine: true isn't an engine/);
    assert.throws(() => create({ signals: 'true' }), /signals: 'true' isn't true or false; write engine: 'signals'/);
    assert.throws(() => create({ engine: 'zubra', signals: true }), /disagree/);
  }
  await assert.rejects(buildRuntime({ components, engine: 'signal' }), /engine: 'signal' isn't an engine/);
  await assert.rejects(buildApp({ components, signals: 1 }), /signals: 1 isn't true or false/);
});

test('an option name it doesn\'t know is warned about, with the nearest it does', () => {
  const said = [];
  const warn = (message) => said.push(message);
  createZubra({ components, production: true, signal: true, prefx: '/z', warn });
  assert.equal(said.length, 2, said.join('\n'));
  assert.match(said[0], /^@zubra\/server: unknown option `signal`; did you mean `engine: 'signals'`\?/);
  assert.match(said[1], /^@zubra\/server: unknown option `prefx`; did you mean `prefix`\?/);
  said.length = 0;
  createEdge({ compiler: {}, Signals: true, cach: false, nothingLikeIt: 1, warn });
  assert.match(said[0], /^@zubra\/server\/edge: unknown option `Signals`; did you mean `engine: 'signals'`/);
  assert.match(said[1], /unknown option `cach`; did you mean `cache`/);
  assert.match(said[2], /unknown option `nothingLikeIt` \(it has /);
  // Every option it documents is known (and an undefined one is left alone).
  said.length = 0;
  createZubra({ components, packages: [], prefix: '/_zubra', cache: true, production: true, devtools: false, imports: {}, warn, gaps: 'warn', clientModules: 'all', inline: true, preload: true, bundle: false, runtime: null, onError: null, streamTimeout: 1, compress: false, reload: false, engine: 'zubra', minify: true, typo: undefined });
  assert.deepEqual(said, []);
});

test('a static export in signals mode writes the TC39 engine as the runtime\'s', () => {
  const out = mkdtempSync(join(tmpdir(), 'zubra-signals-'));
  try {
    createZubra({ components, production: true, engine: 'signals' }).writeAssets(out);
    assert.match(readFileSync(join(out, '_zubra/runtime/signal.js'), 'utf8'), /from\s*["']\.\/signal-impl\.js/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("at the edge, engine: 'signals' and bundle: true are refused together", () => {
  assert.throws(() => createEdge({ compiler: {}, engine: 'signals', bundle: true }), /engine: 'signals' can't go with bundle: true/);
});
