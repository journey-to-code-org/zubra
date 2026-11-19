// The runtime split: a page loads the runtime's base (`zubra.js`) and, of context, form controls
// and helpers, event modifiers and helpers, shadow roots and resource(), only the files its
// components name. A script of the page's own that imports `@zubra/runtime` gets the whole API,
// from the same modules.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createZubra } from '../src/index.js';

const components = mkdtempSync(join(tmpdir(), 'zubra-split-'));
const write = (name, source) => writeFileSync(join(components, name), source);
// Nothing of what is split off.
write('plain-card.zb', '<script>\n  let count = 0\n</script>\n<plain-card label="Plain">\n  <button class="up" onclick={() => count++}>{label}</button> <output>{count}</output>\n</plain-card>\n');
// An event modifier in the template: the compiler names its binder.
write('key-box.zb', '<script>\n  let said = ""\n</script>\n<key-box>\n  <input onkeydown.enter={() => (said = "enter")}> <output>{said}</output>\n</key-box>\n');
// An event helper called by the script: the script's own import names it.
write('guard-link.zb', "<script>\n  import { prevent } from '@zubra/runtime'\n  let went = 0\n  const go = prevent(() => went++)\n</script>\n<guard-link>\n  <a href=\"/elsewhere\" onclick={go}>go</a> <output>{went}</output>\n</guard-link>\n");
// Context, both ends.
write('theme-box.zb', "<script>\n  import { provide } from '@zubra/runtime'\n  import { theme } from './theme.js'\n  import './theme-name.zb'\n  provide(theme, 'dark')\n</script>\n<theme-box>\n  <theme-name></theme-name>\n</theme-box>\n");
write('theme-name.zb', "<script>\n  import { inject } from '@zubra/runtime'\n  import { theme } from './theme.js'\n  const name = inject(theme)\n</script>\n<theme-name>\n  <output>{name}</output>\n</theme-name>\n");
// A plain module beside them, which names the runtime itself.
write('theme.js', "import { createContext } from '@zubra/runtime';\nexport const theme = createContext('light');\n");
// resource().
write('late-word.zb', "<script>\n  import { resource } from '@zubra/runtime'\n  const word = resource(async () => 'ready')\n</script>\n<late-word>\n  <output>{word.value ?? 'waiting'}</output>\n</late-word>\n");
// A form control with a helper, in a shadow root.
write('pick-one.zb', "<script>\n  import { formValue } from '@zubra/runtime'\n  let value = 'a'\n  formValue(() => value)\n</script>\n<pick-one shadow form-associated>\n  <button class=\"b\" onclick={() => (value = 'b')}>b</button>\n</pick-one>\n");

const layout = (body, script = '') => `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${body}${script}</body></html>`;
const preloaded = (html) => [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map((match) => match[1]);
const runtime = (list) => list.filter((url) => url.startsWith('/_zubra/runtime/')).map((url) => url.slice('/_zubra/runtime/'.length)).sort();
/** The page of `tags`, each rendered once (theme-box has a theme-name inside; pick-one is in a form). */
function pageOf(zubra, tags, script) {
  const page = zubra.page();
  const body = tags.map((tag) => (tag === 'pick-one' ? `<form>${page.render(tag).replace('<pick-one', '<pick-one name="pick"')}</form>` : page.render(tag))).join('');
  return page.finish(layout(body, script));
}

let browser;
const servers = [];
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  rmSync(components, { recursive: true, force: true });
});
async function serving(zubra, html) {
  const server = createServer((request, response) => {
    if (zubra.handle(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

test('in production a page preloads the base, and of the split files only those its components name', () => {
  const zubra = createZubra({ components, production: true });
  const files = (tags) => runtime(preloaded(pageOf(zubra, tags)));
  assert.deepEqual(files(['plain-card']), ['zubra.js']);
  assert.deepEqual(files(['key-box']), ['modifiers.js', 'zubra.js'], "a modifier in the template: the compiler's binder");
  assert.deepEqual(files(['guard-link']), ['modifiers.js', 'zubra.js'], "a helper the script imports: the script's own name");
  assert.deepEqual(files(['theme-box']), ['provide.js', 'zubra.js'], 'context, from the components and from the plain module they import');
  assert.deepEqual(files(['late-word']), ['resource.js', 'zubra.js']);
  assert.deepEqual(files(['pick-one']), ['form.js', 'shadow.js', 'zubra.js']);
  assert.deepEqual(files(['plain-card', 'key-box', 'theme-box', 'late-word', 'pick-one']), ['form.js', 'modifiers.js', 'provide.js', 'resource.js', 'shadow.js', 'zubra.js']);
  // Never the whole API (core.js) for a page's components.
  for (const tags of [['plain-card'], ['theme-box'], ['pick-one']]) assert.ok(!files(tags).includes('core.js'));
});

test("each module takes a name from the file that has it, by address; a plain module's and @zubra/sync's too", async () => {
  const zubra = createZubra({ minify: false, components, production: true });
  const text = async (path) => (await zubra.fetch(new Request(`http://localhost${path}`))).text();
  const guard = await text('/_zubra/components/guard-link.js');
  assert.match(guard, /import \{ prevent \} from '\.\.\/runtime\/modifiers\.js';/);
  assert.match(guard, /import \{ \$component as \$define, \$r, \$t \} from "\.\.\/runtime\/zubra\.js";/);
  assert.doesNotMatch(guard, /@zubra\/runtime['"]/);
  assert.match(await text('/_zubra/components/theme.js'), /^import \{ createContext \} from '\.\.\/runtime\/provide\.js';/);
  // One statement that names both: split by file, the names kept as written.
  const both = await text('/_zubra/components/pick-one.js');
  assert.match(both, /import \{ formValue \} from '\.\.\/runtime\/form\.js';/);
  assert.match(both, /import \{ \$form \} from "\.\.\/runtime\/form\.js";/);
  assert.match(both, /import \{ \$shadow \} from "\.\.\/runtime\/shadow\.js";/);
});

test("where `imports` says where the runtime is, every name is taken from that, as before the split", async () => {
  const zubra = createZubra({ minify: false, components, production: true, imports: { '@zubra/runtime': 'https://cdn.example/zubra/core.js' } });
  const text = async (path) => (await zubra.fetch(new Request(`http://localhost${path}`))).text();
  const guard = await text('/_zubra/components/guard-link.js');
  assert.match(guard, /import \{ prevent \} from '@zubra\/runtime'/);
  assert.match(guard, /import \{ \$component as \$define, \$r, \$t \} from "@zubra\/runtime";/);
  assert.match(await text('/_zubra/components/key-box.js'), /import \{ \$modified \} from "@zubra\/runtime";/);
  assert.match(pageOf(zubra, ['guard-link']), /"@zubra\/runtime":"https:\/\/cdn\.example\/zubra\/core\.js"/);
});

for (const [name, production, base] of [['in production', true, 'zubra.js'], ['in development', false, 'base.js']]) {
  test(`in a browser ${name}: every split feature works, and the page asks for the files it was told to and no others`, async () => {
    const zubra = createZubra({ minify: false, components, production });
    const html = pageOf(zubra, ['plain-card', 'key-box', 'guard-link', 'theme-box', 'late-word', 'pick-one']);
    const url = await serving(zubra, html);
    const page = await browser.newPage();
    const errors = [];
    const asked = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    page.on('request', (request) => asked.push(new URL(request.url()).pathname));
    try {
      await page.goto(url);
      await page.waitForFunction(() => ['plain-card', 'key-box', 'guard-link', 'theme-box', 'theme-name', 'late-word', 'pick-one'].every((tag) => customElements.get(tag)));
      await page.click('plain-card .up');
      assert.equal(await page.textContent('plain-card output'), '1');
      await page.press('key-box input', 'a');
      assert.equal(await page.textContent('key-box output'), '', 'another key');
      await page.press('key-box input', 'Enter');
      assert.equal(await page.textContent('key-box output'), 'enter');
      await page.click('guard-link a');
      assert.equal(await page.textContent('guard-link output'), '1');
      assert.equal(new URL(page.url()).pathname, '/', 'prevent() kept the link from being followed');
      assert.equal(await page.textContent('theme-name output'), 'dark');
      await page.waitForFunction(() => document.querySelector('late-word output').textContent === 'ready');
      assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('pick')), 'a');
      await page.click('pick-one .b');
      await page.waitForFunction(() => new FormData(document.querySelector('form')).get('pick') === 'b');
      assert.deepEqual(errors, []);
      const loaded = runtime(asked);
      assert.ok(loaded.includes(base), loaded.join(' '));
      for (const file of ['form.js', 'modifiers.js', 'provide.js', 'resource.js', 'shadow.js']) assert.ok(loaded.includes(file), `${file}: ${loaded.join(' ')}`);
      assert.ok(!loaded.includes('core.js') && !loaded.includes('index.js') && !loaded.includes('legacy.js'), loaded.join(' '));
      if (production) assert.deepEqual(loaded, runtime(preloaded(html)), 'what was preloaded is what was loaded');
    } finally {
      await page.close();
    }
  });
}

test("in a browser: a script of the page's own gets the whole API from `@zubra/runtime`, the same modules its components use", async () => {
  const zubra = createZubra({ components, production: true });
  // (theme.js is the components' own module: the context the page's script provides is theirs.)
  const script = `<script type="module">
    import * as whole from '@zubra/runtime';
    import * as base from '/_zubra/runtime/zubra.js';
    import { provide } from '/_zubra/runtime/provide.js';
    window.checked = { names: ['state', 'effect', 'provide', 'inject', 'createContext', 'resource', 'prevent', 'keys', 'formValue', 'validity', 'adoptStyles', 'watch'].filter((name) => typeof whole[name] !== 'function'), sameState: whole.state === base.state, sameSignal: whole.Signal === base.Signal, sameProvide: whole.provide === provide };
  </script>`;
  const html = pageOf(zubra, ['plain-card'], script);
  assert.match(html, /"@zubra\/runtime":"\/_zubra\/runtime\/core\.js"/);
  const url = await serving(zubra, html);
  const page = await browser.newPage();
  const asked = [];
  page.on('request', (request) => asked.push(new URL(request.url()).pathname));
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.checked);
    assert.deepEqual(await page.evaluate(() => window.checked), { names: [], sameState: true, sameSignal: true, sameProvide: true });
    await page.click('plain-card .up');
    assert.equal(await page.textContent('plain-card output'), '1');
    assert.ok(runtime(asked).includes('core.js'));
  } finally {
    await page.close();
  }
});
