// The documentation site in the built gallery (site/src/docs.njk and _data/docs.js), read as files, with no browser:
// every page of the navigation is built, every link on every page lands on a page or an anchor
// that exists under the base path, and Markdown links didn't survive as links to `.md` files.
//
//   node demos/build.mjs --out _site --base /zubra/ && node --test "demos/test/docs.test.js"
//
// GALLERY (default _site) and GALLERY_BASE (default /zubra/) say where the build is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nav from '../../site/src/_data/nav.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../..', process.env.GALLERY ?? '_site');
const base = process.env.GALLERY_BASE ?? '/zubra/';
const files = nav.flatMap((group) => group.pages.map((page) => page.file));
const slug = (page) => page.slug ?? page.file.replace(/^docs\//, '').replace(/\.md$/, '');
const pages = nav.flatMap((group) => group.pages.map((page) => ({ ...page, path: join(dir, 'docs', slug(page), 'index.html') })));

const html = (path) => readFileSync(path, 'utf8');
const ids = (page) => new Set([...html(page).matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
/** The file a URL under the base path is served from, or null for one that isn't ours. */
const fileFor = (url) => {
  if (!url.startsWith(base)) return null;
  const path = join(dir, url.slice(base.length));
  return url.endsWith('/') ? join(path, 'index.html') : path;
};

test('every page of the navigation is built', () => {
  assert.ok(existsSync(join(dir, 'docs/index.html')), `no docs in ${dir}: run node demos/build.mjs --out ${dir} --base ${base}`);
  assert.equal(pages.length, files.length);
  for (const page of pages) assert.ok(existsSync(page.path), `${page.file} isn't built (${page.path})`);
  assert.match(html(join(dir, 'docs/guide/08-read-the-output/index.html')), /<h1[^>]*>8\. Read the output/);
});

test('every page lists every other page in its sidebar and marks its own', () => {
  for (const page of pages) {
    const source = html(page.path);
    assert.equal((source.match(/aria-current="page"/g) ?? []).length, 1, `${page.file} marks one current page`);
    for (const other of pages) {
      const href = `${base}docs/${slug(other) ? `${slug(other)}/` : ''}`;
      assert.ok(source.includes(`href="${href}"`), `${page.file} links to ${href}`);
    }
  }
});

test('every internal link and anchor resolves', () => {
  let checked = 0;
  for (const page of pages) {
    // Code samples show markup (`<a href="/">`); they aren't links on the page.
    const links = html(page.path).replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/g, '');
    for (const [, href] of links.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      const url = href.replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/.test(url)) continue;
      assert.doesNotMatch(url, /\.md(#|$)/, `${page.file}: "${url}" is a link to a Markdown file`);
      const [path, hash] = url.split('#');
      const target = path ? fileFor(path) : page.path;
      assert.ok(target, `${page.file}: "${url}" isn't under ${base}`);
      assert.ok(existsSync(target), `${page.file}: "${url}" has no file (${target})`);
      if (hash) assert.ok(ids(target).has(decodeURIComponent(hash)), `${page.file}: "${url}" has no such anchor`);
      checked += 1;
    }
  }
  assert.ok(checked > 500, `${checked} links checked: fewer than expected`);
});

test('code in the docs is coloured, not plain text', () => {
  const first = html(join(dir, 'docs/guide/01-first-component/index.html'));
  const block = first.match(/<pre\b[^>]*><code class="language-html">[\s\S]*?<\/code><\/pre>/)?.[0];
  assert.ok(block, 'the first component page has an HTML example');
  assert.match(block, /class="token tag"/, 'tags are coloured');
  assert.match(block, /class="token string"/, 'strings are coloured');
  assert.ok(html(join(dir, 'docs/assets/site.css')).includes('.token.tag'), 'the stylesheet has the colours');
});

test('code blocks and tables that can scroll sideways take focus and are named', () => {
  const first = html(join(dir, 'docs/guide/01-first-component/index.html'));
  const pres = [...first.matchAll(/<pre\b[^>]*>/g)].map((match) => match[0]);
  assert.ok(pres.length >= 3);
  for (const pre of pres) assert.match(pre, /^<pre tabindex="0" role="group" aria-label="Code(, [^"]+)?" data-scrolls>$/, pre);
  assert.ok(pres.includes('<pre tabindex="0" role="group" aria-label="Code, HTML" data-scrolls>'));
  const matrix = html(join(dir, 'docs/framework-matrix/index.html'));
  const tables = (matrix.match(/<table>/g) ?? []).length;
  assert.ok(tables > 0);
  assert.equal((matrix.match(/<div class="table-scroll" tabindex="0" role="region" aria-label="Table" data-scrolls>\s*<table>/g) ?? []).length, tables, 'every table is in a scrolling box');
  // The layout's script drops the tab stop where nothing scrolls.
  assert.match(matrix, /box\.tabIndex = box\.scrollWidth > box\.clientWidth \+ 1 \? 0 : -1/);
});

test('the migration guide is near the top of the sidebar and on the first page; /docs/guide/ goes to the guide', () => {
  const front = html(join(dir, 'docs/index.html'));
  const sidebar = front.slice(front.indexOf('<nav class="side"'));
  const links = [...sidebar.matchAll(/<li><a href="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(links.indexOf(`${base}docs/migrating-to-6.0/`) >= 0 && links.indexOf(`${base}docs/migrating-to-6.0/`) <= 2, links.slice(0, 4).join());
  assert.match(front, new RegExp(`</h1>\\s*<p class="moving">Moving from 5\\.x\\? <a href="${base}docs/migrating-to-6\\.0/">Migrating to 6\\.0</a></p>`));
  // It isn't a step of the guide: the overview's Next is still the starter app.
  assert.match(front, /<a rel="next" href="[^"]+starter-app\/">/);
  const guide = join(dir, 'docs/guide/index.html');
  assert.ok(existsSync(guide), '/docs/guide/ is a page');
  assert.match(html(guide), new RegExp(`<meta http-equiv="refresh" content="0; url=${base}docs/">`));
  assert.match(html(join(dir, 'index.html')), new RegExp(`Moving from 5\\.x\\? <a href="${base}docs/migrating-to-6\\.0/">Migrating to 6\\.0</a>`));
});
