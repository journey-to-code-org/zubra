// `autoImport`: an app file that uses a component's tag gets its import written for it. The text
// halves on their own, the plugin's hook on its own, then real apps (Svelte, Vue, Solid and React
// through Vite; JSX through esbuild) with no import in them, in a browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { build as esbuild } from 'esbuild';
import react from '@vitejs/plugin-react';
import vue from '@vitejs/plugin-vue';
import solid from 'vite-plugin-solid';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import zubra from '../src/vite.js';
import zubraEsbuild from '../src/esbuild.js';
import { unplugin } from '../src/index.js';
import { kindOf, tagsIn, withImports } from '../src/auto-import.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const { chromium } = createRequire(import.meta.url)('playwright');
// Inside plugin/, so the apps resolve the plugin's frameworks and @zubra/runtime.
const work = join(here, '.tmp-auto-import');
const sources = ['../components', '@acme/kit/components'];

const page = '<tap-count></tap-count><name-tag name="Ada"></name-tag><kit-badge></kit-badge>';
const files = {
  'node_modules/@acme/kit/package.json': JSON.stringify({ name: '@acme/kit', exports: { './components/*': './src/*' } }),
  'node_modules/@acme/kit/src/kit-badge.zb': '<kit-badge>\n  <b>kit</b>\n</kit-badge>\n',
  'components/tap-count.zb': '<script>\n  let count = 0\n</script>\n<tap-count>\n  <button type="button" onclick={() => count++}>Tap</button> <output>{count}</output>\n</tap-count>\n',
  // Its file isn't named for its tag: the tag is read from the component.
  'components/nested/label.zb': '<name-tag name>\n  <i>{name}</i>\n</name-tag>\n',
  'components/never-used.zb': '<never-used>\n  <p>NEVER-USED-MARK</p>\n</never-used>\n',
  'svelte/index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>\n',
  'svelte/main.js': "import { mount } from 'svelte';\nimport App from './App.svelte';\nmount(App, { target: document.getElementById('app') });\n",
  'svelte/App.svelte': `<main>${page}</main>\n`,
  'vue/index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.js"></script></body></html>\n',
  'vue/main.js': "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n",
  'vue/App.vue': `<template>\n  <main>${page}</main>\n</template>\n`,
  'solid/index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.jsx"></script></body></html>\n',
  'solid/main.jsx': `import { render } from 'solid-js/web';\nrender(() => <main>${page}</main>, document.getElementById('app'));\n`,
  'react/index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="./main.tsx"></script></body></html>\n',
  'react/main.tsx': `import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('app')!).render(<main>${page}</main>);\n`,
  'esbuild/index.html': '<!doctype html><html><body><div id="app"></div><script type="module" src="./out/main.js"></script></body></html>\n',
  'esbuild/main.jsx': `const h = (tag, props) => Object.assign(document.createElement(tag), props ?? {});\ndocument.getElementById('app').append(<tap-count />, <kit-badge />);\n`,
  // For the hook's own tests.
  'hook/Uses.svelte': '<script>\n  let n = 1;\n</script>\n<tap-count></tap-count>\n<never-heard-of></never-heard-of>\n',
  'hook/Has.svelte': "<script>\n  import '../components/tap-count.zb';\n</script>\n<tap-count></tap-count>\n<name-tag></name-tag>\n",
  'hook/node_modules/dep/Widget.svelte': '<tap-count></tap-count>\n',
  'twice/a/one.zb': '<same-tag>\n  <p>one</p>\n</same-tag>\n',
  'twice/b/two.zb': '<same-tag>\n  <p>two</p>\n</same-tag>\n',
};

let browser;
let server;
before(async () => {
  execFileSync('cargo', ['build', '--quiet'], { cwd: repo, stdio: 'inherit' });
  process.env.ZUBRA_COMPILER ??= join(repo, 'target/debug/zubra');
  rmSync(work, { recursive: true, force: true });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(work, path)), { recursive: true });
    writeFileSync(join(work, path), text);
  }
  server = createServer((request, response) => {
    let file = join(work, new URL(request.url, 'http://x').pathname);
    if (!extname(file)) file = join(file, 'index.html');
    if (!existsSync(file)) return response.writeHead(404).end();
    response.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ?? 'text/plain' }).end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
  rmSync(work, { recursive: true, force: true });
});

test('which files, and which tags', () => {
  assert.equal(kindOf('/app/App.svelte'), 'svelte');
  assert.equal(kindOf('/app/App.vue'), 'vue');
  assert.equal(kindOf('/app/App.tsx'), 'jsx');
  assert.equal(kindOf('/app/App.jsx'), 'jsx');
  for (const other of ['/app/main.ts', '/app/main.js', '/app/x.zb', '/app/index.html', '/app/Page.astro']) assert.equal(kindOf(other), null, other);
  assert.deepEqual(tagsIn('<div><tap-count a="1"/><p>x-y</p><name-tag>\n</name-tag><tap-count></tap-count><a-b-c/></div>'), ['tap-count', 'name-tag', 'a-b-c']);
  // Not a custom element's name: no hyphen, a capital (a framework's own component), a trailing hyphen.
  assert.deepEqual(tagsIn('<div></div><Tap-Count/><TapCount/><tap-/><-tap/> a <b-c d'), ['b-c']);
  // A longer name that only starts like one: JSX's `<ui-kit.Button>`, a namespaced `<my-el:part>`.
  assert.deepEqual(tagsIn('<ui-kit.Button /><my-el:part /><tap-count_x />'), []);
});

test('where the import goes, and no line moves', () => {
  const one = ['./a.zb?element'];
  const lines = (text) => text.split('\n').length;
  const jsx = "import x from 'y';\nexport default () => <tap-count />;\n";
  assert.equal(withImports(jsx, 'jsx', one), `import "./a.zb?element";${jsx}`);
  // After a directive, and the comments above it: before it, the directive would stop being one.
  const client = "// a page\n/* of\n   the app */\n'use client';\nimport x from 'y';\n";
  assert.equal(withImports(client, 'jsx', one), "// a page\n/* of\n   the app */\n'use client';import \"./a.zb?element\";\nimport x from 'y';\n");
  assert.equal(withImports('"use client"\nconst a = 1;\n', 'jsx', one), '"use client";import "./a.zb?element";\nconst a = 1;\n');
  // A comment alone is no directive: the import goes first.
  assert.equal(withImports('// note\nconst a = 1;\n', 'jsx', one), 'import "./a.zb?element";// note\nconst a = 1;\n');

  const two = ['./a.zb?element', '@acme/kit/components/b.zb?element'];
  const both = 'import "./a.zb?element";import "@acme/kit/components/b.zb?element";';
  assert.equal(withImports('<script lang="ts">\n  let n = 1;\n</script>\n<tap-count />\n', 'svelte', two), `<script lang="ts">${both}\n  let n = 1;\n</script>\n<tap-count />\n`);
  // Svelte's module script runs once for the module; the component's own is the one, or a new one.
  const moduleOnly = '<script module>\n  export const a = 1;\n</script>\n<tap-count />\n';
  assert.equal(withImports(moduleOnly, 'svelte', one), `<script>import "./a.zb?element";</script>${moduleOnly}`);
  const moduleAndOwn = '<script module>\n  export const a = 1;\n</script>\n<script>\n  let n;\n</script>\n';
  assert.equal(withImports(moduleAndOwn, 'svelte', one), '<script module>\n  export const a = 1;\n</script>\n<script>import "./a.zb?element";\n  let n;\n</script>\n');
  assert.equal(withImports('<tap-count />\n', 'svelte', one), '<script>import "./a.zb?element";</script><tap-count />\n');

  const setup = '<template>\n  <tap-count />\n</template>\n<script>\nexport default {};\n</script>\n<script setup lang="ts">\nconst n = 1;\n</script>\n';
  assert.equal(withImports(setup, 'vue', one), setup.replace('<script setup lang="ts">', '<script setup lang="ts">import "./a.zb?element";'));
  const options = '<script>\nexport default {};\n</script>\n<template><tap-count /></template>\n';
  assert.equal(withImports(options, 'vue', one), options.replace('<script>', '<script>import "./a.zb?element";'));
  // A <script> inside the template is the page's, not the file's.
  const inTemplate = '<template>\n  <div>\n    <script type="text/x">x</script>\n  </div>\n</template>';
  assert.equal(withImports(inTemplate, 'vue', one), `${inTemplate}\n<script setup>import "./a.zb?element";</script>\n`);

  for (const [text, kind] of [[jsx, 'jsx'], [client, 'jsx'], [moduleOnly, 'svelte'], [moduleAndOwn, 'svelte'], [setup, 'vue'], [options, 'vue']]) {
    assert.equal(lines(withImports(text, kind, two)), lines(text), `${kind}: the same number of lines`);
  }
  // Nothing to import: not even an empty block.
  assert.equal(withImports(inTemplate, 'vue', []), inTemplate);
  assert.equal(withImports('<tap-count />\n', 'svelte', []), '<tap-count />\n');
});

const hook = async (options) => {
  const plugin = unplugin.raw({ root: join(work, 'hook'), ...options }, { framework: 'rollup' });
  await plugin.buildStart?.call({});
  return plugin;
};
const source = (name) => readFileSync(join(work, 'hook', name), 'utf8');

test('off unless asked for', async () => {
  const plugin = await hook({});
  assert.equal(plugin.transformInclude(join(work, 'hook/Uses.svelte')), false);
  assert.equal(plugin.transform.call({}, source('Uses.svelte'), join(work, 'hook/Uses.svelte')), null);
});

test('the hook: the tags it knows, by the path from the file', async () => {
  const plugin = await hook({ autoImport: sources });
  const id = join(work, 'hook/Uses.svelte');
  assert.equal(plugin.transformInclude(id), true);
  assert.equal(plugin.transformInclude(join(work, 'hook/main.ts')), false);
  // <never-heard-of> is nobody's: left alone.
  assert.equal(plugin.transform.call({}, source('Uses.svelte'), id).code, source('Uses.svelte').replace('<script>', '<script>import "../components/tap-count.zb?element";'));
  const all = plugin.transform.call({}, `<main>${page}</main>`, join(work, 'hook/deep/er/Page.svelte')).code;
  assert.equal(all, `<script>import "../../../components/tap-count.zb?element";import "../../../components/nested/label.zb?element";import "../../../node_modules/@acme/kit/src/kit-badge.zb?element";</script><main>${page}</main>`);
  // An import the file has is not written again; the one it lacks is.
  assert.equal(plugin.transform.call({}, source('Has.svelte'), join(work, 'hook/Has.svelte')).code, source('Has.svelte').replace('<script>', '<script>import "../components/nested/label.zb?element";'));
  // Nothing to add: the file is left as it is.
  assert.equal(plugin.transform.call({}, '<p>plain</p>', id), null);
  assert.equal(plugin.transform.call({}, '<never-heard-of />', id), null);
  // One block of a file (the framework's own virtual module) has had its turn; a reload hasn't.
  assert.equal(plugin.transform.call({}, '<tap-count />', `${id}?svelte&type=style&lang.css`), null);
  assert.match(plugin.transform.call({}, '<tap-count />', `${id}?t=1700000000000`).code, /tap-count\.zb\?element/);
  // Someone else's package is theirs to import for.
  assert.equal(plugin.transform.call({}, '<tap-count></tap-count>\n', join(work, 'hook/node_modules/dep/Widget.svelte')), null);
});

test('one folder as a string; a folder that isn\'t there says so; a tag twice warns and the first stays', async () => {
  const single = await hook({ autoImport: '../components' });
  assert.match(single.transform.call({}, '<tap-count />', join(work, 'hook/A.svelte')).code, /components\/tap-count\.zb\?element/);

  const missing = await hook({ autoImport: ['../no-such-folder'] });
  assert.throws(() => missing.transform.call({}, '<tap-count />', join(work, 'hook/A.svelte')), /autoImport: \.\.\/no-such-folder isn't a folder \(looked from /);
  const uninstalled = await hook({ autoImport: ['@acme/not-installed/components'] });
  assert.throws(() => uninstalled.transform.call({}, '<tap-count />', join(work, 'hook/A.svelte')), /autoImport: @acme\/not-installed\/components isn't a folder of an installed package/);

  const twice = await hook({ autoImport: ['../twice/a', '../twice/b'] });
  const warnings = [];
  const context = { warn: (message) => warnings.push(message) };
  assert.match(twice.transform.call(context, '<same-tag />', join(work, 'hook/A.svelte')).code, /twice\/a\/one\.zb\?element/);
  twice.transform.call(context, '<same-tag />', join(work, 'hook/B.svelte'));
  // Said once, however often the folders are read again.
  twice.watchChange.call({}, join(work, 'twice/b/two.zb'));
  twice.transform.call(context, '<same-tag />', join(work, 'hook/B.svelte'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /autoImport: <same-tag> is .*twice\/a\/one\.zb; .*twice\/b\/two\.zb has the same tag and is not imported for it/);
});

test('a component added later is found', async () => {
  const plugin = await hook({ autoImport: sources });
  const id = join(work, 'hook/A.svelte');
  assert.equal(plugin.transform.call({}, '<late-comer />', id), null);
  const added = join(work, 'components/late-comer.zb');
  writeFileSync(added, '<late-comer>\n  <p>late</p>\n</late-comer>\n');
  try {
    plugin.watchChange.call({}, added);
    assert.match(plugin.transform.call({}, '<late-comer />', id).code, /late-comer\.zb\?element/);
  } finally {
    rmSync(added);
  }
});

const frameworks = {
  svelte: () => [svelte()],
  vue: () => [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.includes('-') } } })],
  solid: () => [solid()],
  react: () => [react()],
};
async function works(path) {
  const tab = await browser.newPage();
  const errors = [];
  tab.on('pageerror', (error) => errors.push(error.message));
  await tab.goto(`http://127.0.0.1:${server.address().port}/${path}`);
  await tab.locator('tap-count button').click();
  await tab.locator('tap-count output', { hasText: '1' }).waitFor({ timeout: 5000 });
  const defined = await tab.evaluate(() => ['tap-count', 'name-tag', 'kit-badge', 'never-used'].filter((tag) => customElements.get(tag)));
  const text = await tab.locator('#app').innerText();
  await tab.close();
  assert.deepEqual(errors, []);
  return { defined, text };
}

for (const name of Object.keys(frameworks)) {
  test(`${name} through Vite: a page with no import, its elements defined and working`, async () => {
    const root = join(work, name);
    await build({ root, configFile: false, logLevel: 'silent', base: './', plugins: [zubra({ autoImport: sources }), ...frameworks[name]()], build: { outDir: join(root, 'dist'), minify: false } });
    const { defined, text } = await works(`${name}/dist/`);
    assert.deepEqual(defined, ['tap-count', 'name-tag', 'kit-badge']);
    assert.match(text, /Ada/);
    assert.match(text, /kit/);
    // Only what a page uses is in the build.
    const built = readdirSync(join(root, 'dist/assets')).map((file) => readFileSync(join(root, 'dist/assets', file), 'utf8')).join('');
    assert.doesNotMatch(built, /NEVER-USED-MARK/);
  });
}

test('without the option the same page defines nothing', async () => {
  const root = join(work, 'svelte');
  await build({ root, configFile: false, logLevel: 'silent', base: './', plugins: [zubra(), svelte()], build: { outDir: join(root, 'dist-off'), minify: false } });
  const tab = await browser.newPage();
  await tab.goto(`http://127.0.0.1:${server.address().port}/svelte/dist-off/`);
  await tab.locator('tap-count').waitFor({ state: 'attached' });
  assert.deepEqual(await tab.evaluate(() => ['tap-count', 'name-tag', 'kit-badge'].filter((tag) => customElements.get(tag))), []);
  await tab.close();
});

test('JSX through esbuild (every bundler but Vite takes the same hook)', async () => {
  const root = join(work, 'esbuild');
  await esbuild({ entryPoints: [join(root, 'main.jsx')], outdir: join(root, 'out'), bundle: true, format: 'esm', jsxFactory: 'h', logLevel: 'silent', plugins: [zubraEsbuild({ autoImport: sources, root })] });
  const { defined } = await works('esbuild/');
  assert.deepEqual(defined, ['tap-count', 'kit-badge']);
});
