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
// What the fixture page loads of the runtime in production: the base, and the files its components name.
const SPLIT = ['/_zubra/runtime/zubra.js', '/_zubra/runtime/form.js', '/_zubra/runtime/shadow.js'];
/** What the server answers for a URL: `{ status, type, body }`. */
const get = (zubra, url) => {
  const answer = { status: 404, type: '', body: '' };
  zubra.handle({ url }, { writeHead: (status, headers) => Object.assign(answer, { status, type: headers['content-type'], cache: headers['cache-control'] }), end: (body) => (answer.body = String(body)) });
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
  // The base, and the two files this page's components name: count-stepper is a form control in
  // a shadow root. Nothing else of the runtime (no context, event modifiers or resource()).
  assert.deepEqual(runtime(preloaded(html)), SPLIT);
  // The bare name is the whole script API, for a script of the page's own: the base and the files
  // beside it, the same modules the components load.
  assert.match(html, /"@zubra\/runtime":"\/_zubra\/runtime\/core\.js"/);
  assert.match(String(get(zubra, '/_zubra/runtime/core.js').body), /from"\.\/zubra\.js".*from"\.\/provide\.js".*from"\.\/modifiers\.js"/s);
  const served = get(zubra, '/_zubra/runtime/zubra.js');
  assert.equal(served.status, 200);
  assert.doesNotMatch(String(served.body), /(?:\bfrom|\bimport)\s*["']/, 'it imports nothing');
  // Without it the runtime is the same one file (only the components aren't joined), and file by
  // file in development, where it's read and edited.
  assert.deepEqual(runtime(preloaded(pageOf(createZubra({ components, production: true })))).sort(), [...SPLIT].sort());
  const development = runtime(preloaded(pageOf(createZubra({ components }))));
  assert.ok(development.includes('/_zubra/runtime/base.js') && development.length > 5 && !development.includes('/_zubra/runtime/zubra.js'));
  // (Not core.js: nothing on the page names context, event modifiers or resource().)
  assert.ok(!development.includes('/_zubra/runtime/core.js') && !development.includes('/_zubra/runtime/provide.js'), development.join(' '));
});

test('bundle: no effect in development or with the DevTools, which read the runtime file by file', () => {
  for (const options of [{}, { production: true, devtools: true }]) {
    const html = pageOf(createZubra({ components, bundle: true, ...options }));
    assert.deepEqual(runtime(preloaded(html)), runtime(preloaded(pageOf(createZubra({ components, ...options })))));
    assert.match(html, /"@zubra\/runtime":"\/_zubra\/runtime\/core\.js"/);
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
  assert.match(code, /from\s*["']\.\.\/runtime\/zubra\.js["']/);
  assert.doesNotMatch(code, /@zubra\/runtime["']/);
});

test('bundle: writeAssets writes the bundled runtime', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bundle-'));
  try {
    createZubra({ components, production: true, bundle: true }).writeAssets(dir);
    assert.ok(existsSync(join(dir, '_zubra/runtime/zubra.js')));
    assert.match(readFileSync(join(dir, '_zubra/runtime/core.js'), 'utf8'), /from"\.\/zubra\.js"/);
    // The files beside it, each on the base: one copy of everything, whichever a page loads.
    for (const file of ['form.js', 'shadow.js', 'modifiers.js', 'provide.js', 'resource.js']) assert.match(readFileSync(join(dir, '_zubra/runtime', file), 'utf8'), /from"\.\/zubra\.js"/, file);
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
  assert.deepEqual(runtime(preloaded(html)), SPLIT);
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
  assert.deepEqual(asked.filter((path) => path.startsWith('/_zubra/runtime/')).sort(), [...SPLIT].sort());
  assert.deepEqual(errors, []);
  await page.close();
});

// The page's components as one module (the second half of `bundle`).
const scriptOf = (html) => html.match(/<script type="module"[^>]*>([^<]*)<\/script>/)?.[1] ?? html.match(/<script type="module"[^>]* src="([^"]+)"/)?.[1];
const withComponents = (sources, run) => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-joined-'));
  const done = () => rmSync(dir, { recursive: true, force: true });
  let result;
  try {
    for (const [name, source] of Object.entries(sources)) writeFileSync(join(dir, name), source);
    result = run(dir);
  } catch (error) {
    done();
    throw error;
  }
  // (A test that goes on in a browser keeps the folder until it is through.)
  if (typeof result?.then === 'function') return result.finally(done);
  done();
  return result;
};
const using = (tag, script, body = '<button onclick={() => (n = n + 1)}>{n}</button>') => `<script>\n${script}\n  let n = 0\n</script>\n<${tag}>\n  ${body}\n</${tag}>\n`;

test("bundle: a page's components are one module, named for the set and the hash of what it holds", () => {
  const zubra = createZubra({ minify: false, components, production: true, bundle: true });
  const html = pageOf(zubra);
  const url = html.match(/\/_zubra\/b\/[^'"]+\.js/)[0];
  assert.match(url, /^\/_zubra\/b\/count-stepper\+order-form\.[0-9a-z]{11}\.js$/, 'the component it imports too, sorted');
  assert.equal(scriptOf(html), `import '${url}';`, 'the only module the page asks for itself');
  assert.deepEqual(preloaded(html), [url, ...SPLIT], 'and what is preloaded: it, and what it imports');
  const served = get(zubra, url);
  assert.equal(served.status, 200);
  assert.equal(served.cache, 'public, max-age=31536000, immutable');
  assert.match(served.body, /^\/\/ Generated by zubra: components\/count-stepper\.js, components\/order-form\.js as one module\. Do not edit\.\n/);
  // One import per runtime file its components name: the base, form.js and shadow.js.
  assert.deepEqual(served.body.match(/^import .*$/gm).map((line) => line.match(/from "([^"]+)"/)[1]), ['../runtime/zubra.js', '../runtime/form.js', '../runtime/shadow.js']);
  assert.ok(served.body.includes('"count-stepper"') && served.body.includes('"order-form"'));
  assert.doesNotMatch(served.body, /^export /m);
  // The same from another instance, which never rendered the page: the URL is enough.
  assert.equal(get(createZubra({ minify: false, components, production: true, bundle: true }), url).body, served.body);
  // Not under another hash, in another order, for a set that isn't whole, or without `bundle`.
  for (const other of [url.replace(/\.[0-9a-z]{11}\.js$/, '.00000000000.js'), url.replace('count-stepper+order-form', 'order-form+count-stepper'), url.replace('count-stepper+order-form', 'order-form'), url.replace('count-stepper+order-form', 'count-stepper+nothing')]) {
    assert.equal(get(zubra, other).status, 404, other);
    assert.equal(get(zubra, other).cache, 'no-cache', 'a 404 is never cached: a deploy must not wait an hour for it');
  }
  assert.equal(get(createZubra({ minify: false, components, production: true }), url).status, 404);
  // A component module is still served by its own name, and cached as before.
  assert.equal(get(zubra, '/_zubra/components/order-form.js').cache, 'public, max-age=3600');
});

test('bundle: one component is its own module; a page with none has no script', () => {
  const zubra = createZubra({ components, production: true, bundle: true });
  const page = zubra.page();
  page.render('count-stepper', { value: 1 });
  const html = page.finish(layout(''));
  assert.equal(scriptOf(html), "import '/_zubra/components/count-stepper.js';");
  assert.doesNotMatch(zubra.page().finish(layout('')), /<script type="module"/);
});

test('bundle: a module a component imports stays its own, imported from where the joined module is', () => {
  withComponents({ 'theme.js': 'export const theme = "dark";\n', 'a-one.zb': using('a-one', "  import { theme } from './theme.js'\n  import './a-two.zb'", '<button onclick={() => (n = n + 1)}>{theme} {n}</button><a-two></a-two>'), 'a-two.zb': using('a-two', "  import { theme } from './theme.js'", '<button onclick={() => (n = n + 1)}>{theme}{n}</button>') }, (dir) => {
    const zubra = createZubra({ minify: false, components: dir, production: true, bundle: true });
    const page = zubra.page();
    page.render('a-one', {});
    const html = page.finish(layout(''));
    const url = html.match(/\/_zubra\/b\/a-one\+a-two\.[0-9a-z]{11}\.js/)[0];
    assert.deepEqual(preloaded(html).sort(), [url, '/_zubra/components/theme.js', '/_zubra/runtime/zubra.js'].sort());
    assert.match(get(zubra, url).body, /^import \{ theme \} from "\.\.\/components\/theme\.js";$/m);
  });
});

test('bundle: a set the compiler says must stay apart is served module by module, with the reason', () => {
  withComponents({ 'one.js': 'export const format = (n) => `1:${n}`;\n', 'two.js': 'export const format = (n) => `2:${n}`;\n', 'b-one.zb': using('b-one', "  import { format } from './one.js'\n  import './b-two.zb'", '<button onclick={() => (n = n + 1)}>{format(n)}</button><b-two></b-two>'), 'b-two.zb': using('b-two', "  import { format } from './two.js'", '<button onclick={() => (n = n + 1)}>{format(n)}</button>') }, (dir) => {
    const warnings = [];
    const zubra = createZubra({ components: dir, production: true, bundle: true, warn: (message) => warnings.push(message) });
    const page = zubra.page();
    page.render('b-one', {});
    const html = page.finish(layout(''));
    assert.equal(scriptOf(html), "import '/_zubra/components/b-one.js';");
    assert.ok(preloaded(html).includes('/_zubra/components/b-two.js'));
    assert.deepEqual(warnings.filter((message) => message.includes('separate modules')), ['@zubra/server: b-one, b-two are served as separate modules, not as one: components/b-one.js and components/b-two.js import different things as `format`']);
  });
});

test('bundle: a changed component changes the URL; names that would not fit one are served apart', async () => {
  const { hashOf } = await import('../src/core.js');
  assert.equal(hashOf('a'), hashOf('a'));
  assert.notEqual(hashOf('a'), hashOf('b'));
  assert.match(hashOf(''), /^[0-9a-z]{11}$/);
  const urlOf = (text) => withComponents({ 'c-one.zb': using('c-one', "  import './c-two.zb'", `<button onclick={() => (n = n + 1)}>${text} {n}</button><c-two></c-two>`), 'c-two.zb': using('c-two', '') }, (dir) => {
    const page = createZubra({ components: dir, production: true, bundle: true }).page();
    page.render('c-one', {});
    return page.finish(layout('')).match(/\/_zubra\/b\/[^'"]+\.js/)[0];
  });
  assert.equal(urlOf('Add'), urlOf('Add'));
  assert.notEqual(urlOf('Add'), urlOf('More'));
  const long = 'x'.repeat(90);
  withComponents({ [`${long}-a.zb`]: using(`${long}-a`, `  import './${long}-b.zb'`, `<button onclick={() => (n = n + 1)}>{n}</button><${long}-b></${long}-b>`), [`${long}-b.zb`]: using(`${long}-b`, '') }, (dir) => {
    const page = createZubra({ components: dir, production: true, bundle: true }).page();
    page.render(`${long}-a`, {});
    assert.doesNotMatch(page.finish(layout('')), /\/_zubra\/b\//);
  });
});

test('bundle: writeAssets writes the joined modules of the pages rendered', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bundle-'));
  try {
    const zubra = createZubra({ components, production: true, bundle: true });
    const url = pageOf(zubra).match(/\/_zubra\/b\/[^'"]+\.js/)[0];
    zubra.writeAssets(dir);
    assert.equal(readFileSync(join(dir, url), 'utf8'), get(zubra, url).body);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bundle: a set only a request named is answered, and neither kept for good nor written out", () => {
  const url = pageOf(createZubra({ components, production: true, bundle: true })).match(/\/_zubra\/b\/[^'"]+\.js/)[0];
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bundle-'));
  try {
    // Another instance, which renders no page: it builds the set to answer.
    const zubra = createZubra({ components, production: true, bundle: true });
    assert.equal(get(zubra, url.replace(/\.[0-9a-z]{11}\.js$/, '.00000000000.js')).status, 404);
    assert.equal(get(zubra, url).status, 200, 'the right hash, from what the wrong one built');
    zubra.writeAssets(dir);
    assert.equal(existsSync(join(dir, url)), false, "a visitor's sets are not the site's files");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('bundle: in a browser a page of two components asks for two modules, and both components work', async () => {
  const zubra = createZubra({ components, production: true, bundle: true });
  const server = createServer((request, response) => {
    if (zubra.handle(request, response)) return;
    const page = zubra.page();
    const body = page.render('order-form', {});
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
  await page.waitForFunction(() => customElements.get('count-stepper') && customElements.get('order-form'));
  await page.locator('count-stepper .more').click();
  await page.waitForFunction(() => document.querySelector('count-stepper').shadowRoot.querySelector('output').textContent === '4');
  // The stepper is still the form's control: its value goes with the form.
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('qty')), '4');
  const modules = asked.filter((path) => path.endsWith('.js'));
  // The components as one module, and the runtime: its base and the two files these name.
  assert.equal(modules.length, 1 + SPLIT.length, modules.join(' '));
  assert.match(modules[0], /^\/_zubra\/b\/count-stepper\+order-form\./);
  for (const file of SPLIT) assert.ok(modules.includes(file), file);
  assert.deepEqual(errors, []);
  await page.close();
});

test('bundle with inline: false: the page names the joined module by src, and it imports the runtime by URL', () => {
  const zubra = createZubra({ minify: false, components, production: true, bundle: true, inline: false });
  const html = pageOf(zubra);
  const url = html.match(/<script type="module" src="(\/_zubra\/b\/count-stepper\+order-form\.[0-9a-z]{11}\.js)"><\/script>/)[1];
  assert.doesNotMatch(html, /<script type="module">/);
  const body = get(zubra, url).body;
  assert.match(body, /^import \{[^}]*\} from "\.\.\/runtime\/zubra\.js";$/m);
  assert.match(body, /^import \{ \$form \} from "\.\.\/runtime\/form\.js";$/m);
  assert.doesNotMatch(body, /@zubra\/runtime"/);
});

// A joined module's light-DOM components don't carry the CSS the page's head already has.
const styled = (tag, script, color, host = '') => `<script>\n${script}\n  let n = 0\n</script>\n<style>\n  button { color: ${color}; }\n</style>\n<${tag}${host}>\n  <button onclick={() => (n = n + 1)}>{n}</button>${tag.endsWith('-one') ? `<${tag.replace('-one', '-two')}></${tag.replace('-one', '-two')}>` : ''}\n</${tag}>\n`;
const lightPair = { 'd-one.zb': styled('d-one', "  import './d-two.zb'", 'rgb(255, 0, 0)'), 'd-two.zb': styled('d-two', '', 'rgb(0, 0, 255)') };

test("bundle: the head says whose CSS it has, and a joined light-DOM component has its stylesheet's address, not the text", () => {
  withComponents(lightPair, (dir) => {
    const zubra = createZubra({ minify: false, components: dir, production: true, bundle: true });
    const page = zubra.page();
    page.render('d-one', {});
    const html = page.finish(layout(''));
    assert.match(html, /<style data-zb-components="d-one d-two">/, 'the component rendered and the one it imports');
    assert.ok(html.includes('rgb(255, 0, 0)') && html.includes('rgb(0, 0, 255)'), 'both are in the head');
    const body = get(zubra, html.match(/\/_zubra\/b\/[^'"]+\.js/)[0]).body;
    assert.match(body, /styled: true,\n\s*stylesHref: "\/_zubra\/components\/d-one\.css",\n\s*inPage: true,/);
    assert.match(body, /stylesHref: "\/_zubra\/components\/d-two\.css"/);
    assert.ok(!body.includes('rgb(') && !/\bstyles:/.test(body), 'no CSS text in the module');
    // The address is served (for an element inside a shadow root), with what the head has for it.
    const sheet = get(zubra, '/_zubra/components/d-two.css');
    assert.equal(sheet.status, 200);
    assert.ok(sheet.body.includes('rgb(0, 0, 255)'));
    // The component's own module, by its own URL, is as it always was.
    assert.ok(get(zubra, '/_zubra/components/d-one.js').body.includes('rgb(255, 0, 0)'));
    // Without `bundle` nothing changes: no names in the head, no stylesheet URL.
    const plain = createZubra({ minify: false, components: dir, production: true });
    const plainPage = plain.page();
    plainPage.render('d-one', {});
    assert.match(plainPage.finish(layout('')), /<style data-zb-components>/);
    assert.equal(get(plain, '/_zubra/components/d-two.css').status, 404);
  });
});

test('bundle: where a component of the set has a shadow root, every module keeps its CSS text', () => {
  withComponents({ 'e-one.zb': styled('e-one', "  import './e-two.zb'", 'rgb(255, 0, 0)', ' shadow'), 'e-two.zb': styled('e-two', '', 'rgb(0, 0, 255)') }, (dir) => {
    const zubra = createZubra({ minify: false, components: dir, production: true, bundle: true });
    const page = zubra.page();
    page.render('e-one', {});
    const body = get(zubra, page.finish(layout('')).match(/\/_zubra\/b\/[^'"]+\.js/)[0]).body;
    assert.ok(body.includes('rgb(255, 0, 0)') && body.includes('rgb(0, 0, 255)') && !body.includes('stylesHref'));
  });
});

test('bundle with inline: false: each stylesheet link says whose CSS it has', () => {
  withComponents(lightPair, (dir) => {
    const page = createZubra({ components: dir, production: true, bundle: true, inline: false }).page();
    page.render('d-one', {});
    page.render('d-two', {});
    const html = page.finish(layout(''));
    assert.match(html, /<link rel="stylesheet" href="\/_zubra\/components\/d-one\.css" data-zb-components="d-one d-two">/);
    assert.match(html, /<link rel="stylesheet" href="\/_zubra\/components\/d-two\.css" data-zb-components="d-two">/);
  });
});

test("bundle: in a browser the joined light-DOM components are styled by the page's CSS, and fetch nothing for it", async () => {
  await withComponents(lightPair, async (dir) => {
    const zubra = createZubra({ components: dir, production: true, bundle: true });
    const server = createServer((request, response) => {
      if (zubra.handle(request, response)) return;
      const page = zubra.page();
      const body = page.render('d-one', {});
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(page.finish(layout(`${body}<div id="host"></div>`)));
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    servers.push(server);
    const page = await browser.newPage();
    const asked = [];
    const errors = [];
    page.on('request', (request) => asked.push(new URL(request.url()).pathname));
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => customElements.get('d-one') && customElements.get('d-two'));
    await page.locator('d-one > button').click();
    await page.waitForFunction(() => document.querySelector('d-one > button').textContent === '1');
    const colors = await page.evaluate(() => ['d-one > button', 'd-two > button'].map((selector) => getComputedStyle(document.querySelector(selector)).color));
    assert.deepEqual(colors, ['rgb(255, 0, 0)', 'rgb(0, 0, 255)']);
    assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0, "the page's <style> is the only copy");
    assert.deepEqual(asked.filter((path) => path.endsWith('.css')), []);
    // Inside a shadow root the page's CSS doesn't reach: there the stylesheet is fetched.
    await page.evaluate(() => document.getElementById('host').attachShadow({ mode: 'open' }).append(document.createElement('d-two')));
    await page.waitForFunction(() => getComputedStyle(document.getElementById('host').shadowRoot.querySelector('button')).color === 'rgb(0, 0, 255)');
    assert.deepEqual(asked.filter((path) => path.endsWith('.css')), ['/_zubra/components/d-two.css']);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test('a joined module only a URL asks for is built once and kept among the most recent, whatever its hash', async () => {
  const { createCore } = await import('../src/core.js');
  // Seven components, each importing nothing: any two or more of them are a set (120 sets).
  const names = ['a-one', 'a-two', 'a-three', 'a-four', 'a-five', 'a-six', 'a-seven'];
  let joins = 0;
  const core = createCore({
    request: (body) => {
      if (body.command === 'load') return { ok: true, output: null };
      if (body.command === 'join') {
        joins++;
        return { ok: true, output: `// ${body.modules.map((module) => module.path).join(' ')}` };
      }
      if (body.emit === 'interface') return { ok: true, output: JSON.stringify({ tag: body.path.slice(3, -3), shadow: false, form: false, props: [] }) };
      if (body.emit === 'js') return { ok: true, output: `export const tag = ${JSON.stringify(body.path)};` };
      return { ok: true, output: '' };
    },
    files: new Map(names.map((name) => [name, `/c/${name}.zb`])),
    sourcesOf: (path) => ({ [path]: `<${path.slice(3, -3)}></${path.slice(3, -3)}>` }),
    base: '/_zubra',
    bundle: true,
    warn: () => {},
  });
  const ask = (set) => core.serve(`/_zubra/b/${set}.0000000000.js`)?.status;
  // A wrong hash, asked again and again: one join.
  for (let i = 0; i < 5; i++) assert.equal(ask('a-one+a-two'), 404);
  assert.equal(joins, 1, 'the same set is joined once');
  // Every set, once: a join each. Then the first again, which the most recent 64 no longer
  // have (so asking for set after set doesn't grow memory without end), and the last, which they do.
  const sets = [];
  for (let mask = 1; mask < 1 << names.length; mask++) {
    const set = names.filter((_, i) => mask & (1 << i)).sort();
    if (set.length > 1) sets.push(set.join('+'));
  }
  assert.equal(sets.length, 120);
  joins = 0;
  for (const set of sets) ask(set);
  assert.equal(joins, 119, 'a join each (a-one+a-two, the first, was still kept from above)');
  ask(sets[0]);
  assert.equal(joins, 120, 'the oldest was let go, and is built again');
  ask(sets.at(-1));
  assert.equal(joins, 120, 'the newest is kept');
  // A set whose names aren't all components is refused before anything is joined.
  assert.equal(ask('a-one+nope'), 404);
  assert.equal(joins, 120);
});
