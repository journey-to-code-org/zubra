import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { createRouter } from '../src/index.js';

const components = fileURLToPath(new URL('./components', import.meta.url));
const zubra = createZubra({ components });
const errors = [];
const router = await createRouter({ zubra, components, onError: (error) => errors.push(error) });

const get = async (path, method = 'GET') => router.fetch(new Request(`http://localhost${path}`, { method }));

test('the table has every route, by directive and by folder, most specific first', () => {
  // Segment by segment, text before a parameter before a wildcard; then the longer pattern.
  assert.deepEqual(router.routes().map((route) => [route.pattern, route.name]), [
    ['/farm/stock', 'farm-stock'],
    ['/farms/new', 'routes/farms/new'],
    ['/farms/:id', 'farm-page'],
    ['/docs/:path*', 'routes/docs/[...path]'],
    ['/', 'home-page'],
    ['/about', 'routes/about'],
    ['/broken', 'broken-page'],
    ['/farm', 'farm-today'],
    ['/farmers', 'farmers-page'],
  ]);
  assert.equal(router.match('/farms/new').name, 'routes/farms/new', 'a static segment beats a parameter');
  assert.deepEqual(router.match('/farms/hilltop'), { name: 'farm-page', pattern: '/farms/:id', params: { id: 'hilltop' } });
  assert.equal(router.match('/nowhere'), null);
});

test('a route renders as a whole page on the server', async () => {
  const response = await get('/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  const html = await response.text();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<home-page[^>]*>[\s\S]*<h1>Home<\/h1>/);
  assert.match((await (await get('/about')).text()), /<h1>About<\/h1>/);
  assert.match((await (await get('/farms/new')).text()), /<h1>New farm<\/h1>/);
});

test('app.zb is around every page, with the page in its slot and the current link marked', async () => {
  assert.deepEqual(router.layouts(), [
    { name: 'app', pattern: '/', root: false },
    { name: 'farm-shell', pattern: '/farm', root: true },
    { name: 'routes/docs/layout', pattern: '/docs', root: false },
  ]);
  const home = await (await get('/')).text();
  assert.match(home, /^<!doctype html>\n<html lang="en"><head><meta charset="utf-8">/);
  assert.match(home, /<body><app-shell[\s\S]*<header class="public">[\s\S]*<main>[\s\S]*<home-page[\s\S]*<h1>Home<\/h1>[\s\S]*<\/main>\s*<\/app-shell>/);
  assert.match(home, /<a href="\/" aria-current="page">Home<\/a>/);
  assert.match(home, /<a href="\/about">About<\/a>/);
  const about = await (await get('/about')).text();
  assert.match(about, /<a href="\/about" aria-current="page">About<\/a>/);
  assert.match(about, /<a href="\/">Home<\/a>/);
  // The shell hydrates too: its module is on the page.
  assert.match(home, /_zubra\/components\/app\.js/);
});

test('a layout wraps the pages under its prefix, inside the shell', async () => {
  assert.deepEqual(router.routes().find((route) => route.name === 'routes/docs/[...path]').layouts, ['app', 'routes/docs/layout']);
  const docs = await (await get('/docs/guide/routing')).text();
  assert.match(docs, /<app-shell[\s\S]*<main>[\s\S]*<docs-shell[\s\S]*<aside class="docs">Docs<\/aside>[\s\S]*<docs-page[\s\S]*guide\/routing[\s\S]*<\/docs-shell>[\s\S]*<\/main>/);
});

test("a root layout replaces the shell for its prefix; its load is its own props", async () => {
  const stock = await (await get('/farm/stock?as=Grace')).text();
  assert.match(stock, /<body><farm-shell[\s\S]*<section>[\s\S]*<farm-stock[\s\S]*<h1>Stock<\/h1>[\s\S]*<\/section>\s*<\/farm-shell>/);
  assert.doesNotMatch(stock, /app-shell|class="public"/, 'no public header');
  assert.match(stock, /<a href="\/farm\/stock" aria-current="page">Stock<\/a>/);
  assert.match(stock, /<a href="\/farm">Today<\/a>/);
  assert.match(stock, /<p class="farmer">Grace<\/p>/);
  assert.doesNotMatch(stock, /stays on the server/);
  const today = await (await get('/farm')).text();
  assert.match(today, /<a href="\/farm" aria-current="page">Today<\/a>/);
  assert.match(today, /<p class="farmer">Ada<\/p>/);
  // A prefix is whole segments: /farmers isn't under /farm.
  const farmers = await (await get('/farmers')).text();
  assert.match(farmers, /<app-shell/);
  assert.doesNotMatch(farmers, /farm-shell/);
});

test('lang and head go on every page', async () => {
  const styled = await createRouter({
    zubra,
    components,
    lang: 'en-GB',
    head: ({ route }) => `<link rel="stylesheet" href="/site.css"><meta name="at" content="${route.pattern}">`,
  });
  const html = await (await styled.fetch(new Request('http://localhost/farms/hilltop'))).text();
  assert.match(html, /<html lang="en-GB">/);
  assert.match(html, /<head>[\s\S]*<link rel="stylesheet" href="\/site\.css"><meta name="at" content="\/farms\/:id">[\s\S]*<\/head>/);
});

test("load's result becomes the page's props; a parameter the page declares is passed too", async () => {
  const html = await (await get('/farms/hilltop?q=apples')).text();
  assert.match(html, /<h1>Hilltop Farm<\/h1>/);
  assert.match(html, /<p class="query">apples<\/p>/);
  // Only what the page declares reaches it.
  assert.doesNotMatch(html, /sk_live_router|dropped/);
  const docs = await (await get('/docs/guide/routing')).text();
  assert.match(docs, /<p class="path">guide\/routing<\/p>/);
});

test("load and what only it imports never reach the browser", async () => {
  const module = await (await zubra.fetch(new Request('http://localhost/_zubra/components/farm-page.js'))).text();
  assert.doesNotMatch(module, /farms\.js|sk_live_router|function load|Hilltop/);
  const served = await zubra.fetch(new Request('http://localhost/_zubra/components/farms.js'));
  assert.equal(served?.status ?? 404, 404);
});

test('an unknown path, a post and a thrown load', async () => {
  assert.equal(await get('/nowhere'), null, "not the router's: the app's next handler decides");
  assert.equal(await router.fetch(new Request('http://localhost/', { method: 'POST', body: 'x' })), null);
  const head = await get('/', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const broken = await get('/broken');
  assert.equal(broken.status, 500);
  assert.equal(await broken.text(), 'Internal error', 'never the message');
  assert.equal(errors.at(-1).message, 'the database is down');
});

test("Node's http: handle answers routes, the listener answers everything else with 404", async () => {
  const server = createServer(router.listener);
  await new Promise((done) => server.listen(0, done));
  after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  const page = await fetch(`${base}/farms/ridge`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<h1>Ridge Orchard<\/h1>/);
  const missing = await fetch(`${base}/nowhere`);
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), 'Not found');
  // handle() leaves what isn't a route to the app.
  const chained = createServer(async (req, res) => {
    if (await router.handle(req, res)) return;
    res.writeHead(418).end('the app');
  });
  await new Promise((done) => chained.listen(0, done));
  after(() => chained.close());
  const other = `http://localhost:${chained.address().port}`;
  assert.equal((await fetch(`${other}/`)).status, 200);
  assert.equal((await fetch(`${other}/static/site.css`)).status, 418);
  assert.equal((await fetch(`${other}/`, { method: 'POST', body: 'x' })).status, 418);
});

/** A components folder of its own, for one mistake. */
async function tableError(files) {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-router-'));
  try {
    for (const [path, source] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), source);
    }
    await createRouter({ zubra: createZubra({ components: dir }), components: dir, cacheDir: join(dir, '.cache') });
  } catch (error) {
    return error.message;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return null;
}

test('two routes with one pattern are an error naming both', async () => {
  const message = await tableError({
    'a-page.zb': "<script>'use route /same'</script>\n<a-page></a-page>\n",
    'routes/same.zb': "<script>'use route'</script>\n<b-page></b-page>\n",
  });
  assert.match(message, /a-page\.zb and .*routes[\\/]same\.zb are both routes for \/same/);
});

test("a folder route's parameters are checked like a written one's", async () => {
  assert.match(
    await tableError({ 'routes/farms/[id].zb': "<script>'use route'</script>\n<farm-page></farm-page>\n" }),
    /is \/farms\/:id, whose parameter `id` neither `load` nor a prop reads/,
  );
  assert.equal(await tableError({ 'routes/farms/[id].zb': '<script>\'use route\'</script>\n<farm-page id=""></farm-page>\n' }), null, 'a prop reads it');
  assert.equal(
    await tableError({ 'routes/farms/[id].zb': "<script>'use route'\nexport function load({ params }) { return { name: params.id } }</script>\n<farm-page name=\"\"></farm-page>\n" }),
    null,
    'load reads it',
  );
  assert.match(
    await tableError({ 'routes/farms/[id].zb': "<script>'use route'\nexport function load({ params }) { return { name: params.slug } }</script>\n<farm-page name=\"\"></farm-page>\n" }),
    /parameter `id` neither/,
  );
});

test('a bare route outside routes/, and a written path that disagrees with its folder', async () => {
  assert.match(
    await tableError({ 'lost-page.zb': "<script>'use route'</script>\n<lost-page></lost-page>\n" }),
    /says 'use route' with no path, and isn't in a routes\/ folder/,
  );
  assert.match(
    await tableError({ 'routes/about.zb': "<script>'use route /info'</script>\n<about-page></about-page>\n" }),
    /says 'use route \/info', but its place in routes\/ makes it \/about/,
  );
  assert.match(
    await tableError({ 'routes/[id.zb': "<script>'use route'</script>\n<odd-page></odd-page>\n" }),
    /plain text or one \[param\]/,
  );
});

test('layout mistakes are named', async () => {
  const page = "<script>'use route /'</script>\n<home-page></home-page>\n";
  assert.match(
    await tableError({ 'home-page.zb': page, 'app.zb': '<app-shell><header>Site</header></app-shell>\n' }),
    /app\.zb is a layout with nowhere for its page: put `<zb-slot><\/zb-slot>`/,
  );
  assert.match(
    await tableError({ 'home-page.zb': page, 'app.zb': '<app-shell><zb-slot></zb-slot></app-shell>\n', 'other-shell.zb': "<script>'use layout /'</script>\n<other-shell><zb-slot></zb-slot></other-shell>\n" }),
    /app\.zb and .*other-shell\.zb are both layouts for \//,
  );
  assert.match(
    await tableError({ 'app.zb': "<script>'use route /'</script>\n<app-shell><zb-slot></zb-slot></app-shell>\n" }),
    /app\.zb is the app's shell, the layout around every page: it can say 'use layout \/' \(to export `load`\), not 'use route \/'/,
  );
  assert.match(
    await tableError({ 'side-shell.zb': "<script>'use layout'</script>\n<side-shell><zb-slot></zb-slot></side-shell>\n" }),
    /says 'use layout' with no prefix, and isn't a layout\.zb in a routes\/ folder/,
  );
  assert.match(
    await tableError({ 'routes/farm/layout.zb': "<script>'use layout /field'</script>\n<side-shell><zb-slot></zb-slot></side-shell>\n" }),
    /says 'use layout \/field', but its place in routes\/ makes it \/farm/,
  );
  // The shell may say what it is, to have a load.
  assert.equal(
    await tableError({ 'home-page.zb': page, 'app.zb': "<script>'use layout /'\nexport function load() { return { year: 2026 } }</script>\n<app-shell year={0}><zb-slot></zb-slot></app-shell>\n" }),
    null,
  );
});

test('createRouter needs the app\'s createZubra()', async () => {
  await assert.rejects(createRouter({ components }), /needs the app's createZubra\(\)/);
});
