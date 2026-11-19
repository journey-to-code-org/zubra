// Signals mode (experimental): `signals: true` serves @zubra/runtime's TC39 engine
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
import { buildRuntime } from '../src/build.js';

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

test('signals: true serves the TC39 engine as the runtime\'s, file by file in production too', () => {
  for (const production of [false, true]) {
    const plain = createZubra({ components, production });
    const signals = createZubra({ components, production, signals: true });
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
    const zubra = createZubra({ components, production: true, signals });
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

test('a built runtime is built with the same signals option as the server that sends it', async () => {
  const built = await buildRuntime({ components, signals: true });
  assert.equal(built.signals, true);
  assert.ok(built.code.includes(TC39_ENGINE), 'the TC39 engine is in it');
  const plain = await buildRuntime({ components });
  assert.equal(plain.signals, undefined);
  assert.ok(!plain.code.includes(TC39_ENGINE));
  assert.throws(() => createZubra({ components, production: true, runtime: built }), /built with signals: true, and this server doesn't have it/);
  assert.throws(() => createZubra({ components, production: true, signals: true, runtime: plain }), /built without signals: true, and this server has it/);
  createZubra({ components, production: true, signals: true, runtime: built });
});

test('a static export in signals mode writes the TC39 engine as the runtime\'s', () => {
  const out = mkdtempSync(join(tmpdir(), 'zubra-signals-'));
  try {
    createZubra({ components, production: true, signals: true }).writeAssets(out);
    assert.match(readFileSync(join(out, '_zubra/runtime/signal.js'), 'utf8'), /from\s*["']\.\/signal-impl\.js/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('at the edge, signals: true and bundle: true are refused together', () => {
  assert.throws(() => createEdge({ compiler: {}, signals: true, bundle: true }), /signals: true can't go with bundle: true/);
});
