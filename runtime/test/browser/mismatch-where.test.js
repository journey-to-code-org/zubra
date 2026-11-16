// Server markup that doesn't have the template's shape is rendered fresh, and the development
// build's warning says where the two part ways: the top-level shapes, or the first binding whose
// place holds something else. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useBrowser, open, here, compiler, production, runtimeOnly } from './harness.js';

const source = join(here, 'fixtures/menu-item.zb');
useBrowser({ 'menu-item': source });

const skip = runtimeOnly || (production && 'the production build has no messages');
let rendered = 0;
const server = (props) => {
  const file = join(tmpdir(), `zb-mismatch-${process.pid}-${rendered++}.json`);
  writeFileSync(file, JSON.stringify(props));
  return compiler(source, '--props', file, '--partial');
};
/** The one warning a page with this markup logs, after checking the element still works. */
async function warningFor(markup) {
  const { page, messages } = await open(markup, { modules: ['menu-item'] });
  const text = await page.evaluate(async () => {
    const host = document.querySelector('menu-item');
    host.left = 0;
    await host.updateComplete;
    return host.querySelector('p').textContent;
  });
  assert.equal(text, 'Bun today · Sold out', 'rendered fresh, and live');
  await page.close();
  const warnings = messages.filter((message) => message.includes("doesn't match its template"));
  assert.equal(warnings.length, 1, messages.join('\n'));
  return warnings[0];
}

test('the server\'s own markup is taken over without a word', { skip }, async () => {
  const { page, messages } = await open(server({ name: 'Bun', left: 3 }), { modules: ['menu-item'] });
  assert.deepEqual(messages, []);
  await page.close();
});

test('a missing top-level element: the warning gives both top-level shapes', { skip }, async () => {
  const markup = server({ name: 'Bun', left: 3 }).replace(/<h3>.*?<\/h3>/, '');
  const warning = await warningFor(markup);
  assert.match(warning, /rendering it fresh: the template's top level is <h3> <p> <form>, and the markup's is <p> <form> \(positions count elements and markers\)/);
});

test('a region that isn\'t where the template has one: the warning names the binding, its place and what is there', { skip }, async () => {
  // The zb-if's markers gone, its <span> left behind (a tool that rewrote the paragraph).
  const markup = server({ name: 'Bun', left: 3 }).replace(/<\?zb \[\?>(<span>.*?<\/span>)<\?zb \]\?>/, '$1');
  assert.notEqual(markup, server({ name: 'Bun', left: 3 }));
  const warning = await warningFor(markup);
  assert.match(warning, /the template expects a zb-if region in <menu-item> › <p>, at position 2, and the markup has <span>/);
});

test('an element that isn\'t there: the warning names the attribute it was for and the position that is empty', { skip }, async () => {
  const markup = server({ name: 'Bun', left: 3 }).replace(/<button[^>]*>Add<\/button>/, '');
  const warning = await warningFor(markup);
  assert.match(warning, /the template expects an element \(for its disabled binding\) in <menu-item> › <form>, at position 3, and the markup has nothing/);
});

test('a path that ends early: the warning says how far the markup goes', { skip }, async () => {
  // The form replaced by one with no children: the binding is on an <input> inside its <label>.
  const markup = server({ name: 'Bun', left: 3 }).replace(/<form[\s\S]*<\/form>/, '<form method="post"></form>');
  const warning = await warningFor(markup);
  assert.match(warning, /the template expects an element \(for its disabled binding\) in <menu-item> › <form>, and the markup has nothing at position 1 there/);
});
