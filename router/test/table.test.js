import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URLPattern } from 'urlpattern-polyfill/urlpattern';
import { buildTable, folderPattern, layoutsFor, matcher, patternParams } from '../src/table.js';

test('a place in routes/ is a path', () => {
  assert.equal(folderPattern('routes/index'), '/');
  assert.equal(folderPattern('routes/about'), '/about');
  assert.equal(folderPattern('routes/farms/index'), '/farms');
  assert.equal(folderPattern('routes/farms/[id]'), '/farms/:id');
  assert.equal(folderPattern('routes/farms/[id]/orders'), '/farms/:id/orders');
  assert.equal(folderPattern('routes/docs/[...path]'), '/docs/:path*');
  assert.equal(folderPattern('farm-page'), null);
  assert.equal(folderPattern('routes'), null);
  assert.throws(() => folderPattern('routes/a:b'), /plain text or one \[param\]/);
});

test("a pattern's parameters", () => {
  assert.deepEqual(patternParams('/farms/:id/orders/:order'), ['id', 'order']);
  assert.deepEqual(patternParams('/docs/:path*'), ['path']);
  assert.deepEqual(patternParams('/a\\:b'), []);
});

test('a catch-all is tried last, whatever order the files came in', () => {
  const page = (name, pattern) => ({ name, props: ['path', 'id'], route: { kind: 'page', pattern } });
  const { pages } = buildTable([page('all', '/:path*'), page('farm', '/farms/:id'), page('home', '/'), page('new', '/farms/new')]);
  assert.deepEqual(pages.map((entry) => entry.name), ['new', 'farm', 'home', 'all']);
  const match = matcher(pages, URLPattern);
  assert.equal(match('/farms/new').page.name, 'new');
  assert.deepEqual(match('/farms/x').params, { id: 'x' });
  assert.equal(match('/').page.name, 'home');
  assert.deepEqual(match('/a/b').params, { path: 'a/b' });
});

test('layouts are recorded, by prefix, apart from pages', () => {
  const { pages, layouts } = buildTable([{ name: 'farm-shell', route: { kind: 'layout', pattern: '/farm', root: true } }]);
  assert.deepEqual(pages, []);
  assert.equal(layouts[0].pattern, '/farm');
  assert.equal(layouts[0].root, true);
  assert.throws(() => buildTable([{ name: 'a', route: { kind: 'layout', pattern: '/x' } }, { name: 'b', route: { kind: 'layout', pattern: '/x' } }]), /both layouts for \/x/);
});

test("a layout's folder is its prefix", () => {
  assert.equal(folderPattern('routes/layout', 'layout'), '/');
  assert.equal(folderPattern('routes/farm/layout', 'layout'), '/farm');
  assert.equal(folderPattern('routes/farms/[id]/layout', 'layout'), '/farms/:id');
  assert.equal(folderPattern('routes/farm/shell', 'layout'), null);
});

test('the layouts around a page: whole segments, outermost first, from the innermost root', () => {
  const layout = (name, pattern, root = false) => ({ name, pattern, root });
  const layouts = [layout('farm', '/farm', true), layout('app', '/'), layout('stock', '/farm/stock'), layout('one', '/farms/:id')];
  const names = (pattern) => layoutsFor(pattern, layouts).map((each) => each.name);
  assert.deepEqual(names('/'), ['app']);
  assert.deepEqual(names('/about'), ['app']);
  assert.deepEqual(names('/farmers'), ['app']);
  assert.deepEqual(names('/farm'), ['farm']);
  assert.deepEqual(names('/farm/stock/low'), ['farm', 'stock']);
  assert.deepEqual(names('/farms/:id/orders'), ['app', 'one']);
  assert.deepEqual(names('/farms/:slug'), ['app'], "a parameter's name is part of the prefix");
  // No shell at all: a page is rendered alone.
  assert.deepEqual(layoutsFor('/about', []), []);
});
