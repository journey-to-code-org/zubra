// `bundle`: in production @zubra/server sends the runtime as one file (`runtime/zubra.js`,
// @zubra/runtime's `dist/bundled`) where it sent the entry and the six modules the entry imports
// (plan: roadmap-footprint F2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createZubra } from '../src/index.js';
import { createZubra as createEdge } from '../src/edge.js';

const here = dirname(fileURLToPath(import.meta.url));
const components = join(here, 'components');
const layout = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}</body></html>`;
const preloaded = (html) => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((match) => match[1]);
const runtime = (links) => links.filter((link) => link.startsWith('/_zubra/runtime/'));
/** What the server answers for a URL: `{ status, type, body }`. */
const get = (zubra, url) => {
  const answer = { status: 404, type: '', body: '' };
  zubra.handle({ url }, { writeHead: (status, headers) => Object.assign(answer, { status, type: headers['content-type'] }), end: (body) => (answer.body = String(body)) });
  return answer;
};
const pageOf = (zubra) => {
  const page = zubra.page();
  page.render('order-form', {});
  return page.finish(layout(''));
};

let browser;
const servers = [];
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
});

test('bundle: a production page maps and preloads the runtime as one module, and the server has it', () => {
  const zubra = createZubra({ components, production: true, bundle: true });
  const html = pageOf(zubra);
  assert.deepEqual(runtime(preloaded(html)), ['/_zubra/runtime/zubra.js']);
  assert.match(html, /"@zubra\/runtime":"\/_zubra\/runtime\/zubra\.js"/);
  const served = get(zubra, '/_zubra/runtime/zubra.js');
  assert.equal(served.status, 200);
  assert.doesNotMatch(String(served.body), /(?:\bfrom|\bimport)\s*["']/, 'it imports nothing');
  // Without it, as before: the entry and its modules.
  const plain = runtime(preloaded(pageOf(createZubra({ components, production: true }))));
  assert.ok(plain.includes('/_zubra/runtime/index.js') && plain.length > 5 && !plain.includes('/_zubra/runtime/zubra.js'));
});

test('bundle: no effect in development or with the DevTools, which read the runtime file by file', () => {
  for (const options of [{}, { production: true, devtools: true }]) {
    const html = pageOf(createZubra({ components, bundle: true, ...options }));
    assert.deepEqual(runtime(preloaded(html)), runtime(preloaded(pageOf(createZubra({ components, ...options })))));
    assert.match(html, /"@zubra\/runtime":"\/_zubra\/runtime\/index\.js"/);
  }
});

test("bundle: the runtime's other modules import the one file, and are preloaded with it", () => {
  const zubra = createZubra({ components, production: true, bundle: true });
  const spread = String(get(zubra, '/_zubra/runtime/spread.js').body);
  assert.match(spread, /from"\.\/zubra\.js"/);
  assert.doesNotMatch(spread, /from"\.\/(?:element|effect|signal)\.js"/);
  // A component that spreads loads spread.js: preloaded, with the one file and nothing else.
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bundle-'));
  try {
    writeFileSync(join(dir, 'spread-link.zb'), '<script>\n  let attrs = { title: "x" }\n</script>\n<spread-link>\n  <a {...attrs} onclick={() => (attrs = { title: "y" })}>link</a>\n</spread-link>\n');
    const page = createZubra({ components: dir, production: true, bundle: true }).page();
    page.render('spread-link', {});
    assert.deepEqual(runtime(preloaded(page.finish(layout('')))).sort(), ['/_zubra/runtime/spread.js', '/_zubra/runtime/zubra.js']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A module that went into the one file is still served by name, from it.
  assert.match(String(get(zubra, '/_zubra/runtime/effect.js').body), /export\{[^}]*\beffect\b[^}]*\}from"\.\/zubra\.js"/);
});

test('bundle with inline: false: a served component imports the one file by its URL', () => {
  const zubra = createZubra({ components, production: true, bundle: true, inline: false });
  const code = String(get(zubra, '/_zubra/components/order-form.js').body);
  assert.match(code, /from\s*["']\/_zubra\/runtime\/zubra\.js["']/);
  assert.doesNotMatch(code, /@zubra\/runtime["']/);
});

test('bundle: writeAssets writes the bundled runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bundle-'));
  try {
    createZubra({ components, production: true, bundle: true }).writeAssets(dir);
    assert.ok(existsSync(join(dir, '_zubra/runtime/zubra.js')));
    assert.match(readFileSync(join(dir, '_zubra/runtime/index.js'), 'utf8'), /from"\.\/zubra\.js"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const wasmPath = fileURLToPath(import.meta.resolve('@zubra/compiler/zubra.wasm'));
if (process.env.ZUBRA_REQUIRE_WASM && !existsSync(wasmPath)) throw new Error('ZUBRA_REQUIRE_WASM is set but @zubra/compiler has no zubra.wasm');
const skip = existsSync(wasmPath) ? false : 'zubra.wasm is not built (npm run build in compiler)';

test('bundle at the edge: the same page as Node, where the host serves dist/bundled', { skip }, () => {
  const sources = Object.fromEntries(readdirSync(components).filter((name) => name.endsWith('.zb')).map((name) => [name.slice(0, -3), readFileSync(join(components, name), 'utf8')]));
  const edge = createEdge({ wasm: new WebAssembly.Module(readFileSync(wasmPath)), components: sources, bundle: true });
  const html = pageOf(edge);
  assert.deepEqual(runtime(preloaded(html)), ['/_zubra/runtime/zubra.js']);
  assert.equal(html, pageOf(createZubra({ components, production: true, bundle: true })));
});

test('bundle: in a browser the page works and asks for one runtime module', async () => {
  const zubra = createZubra({ components, production: true, bundle: true });
  const server = createServer((request, response) => {
    if (zubra.handle(request, response)) return;
    const page = zubra.page();
    const body = page.render('count-stepper', { value: 2 });
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(page.finish(layout(body)));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  const page = await browser.newPage();
  const asked = [];
  const errors = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => customElements.get('count-stepper'));
  assert.equal(await page.locator('count-stepper output').innerText(), '2', 'as the server rendered it');
  await page.locator('count-stepper .more').click();
  await page.waitForFunction(() => document.querySelector('count-stepper').shadowRoot.querySelector('output').textContent === '3');
  assert.deepEqual(asked.filter((path) => path.startsWith('/_zubra/runtime/')), ['/_zubra/runtime/zubra.js']);
  assert.deepEqual(errors, []);
  await page.close();
});
