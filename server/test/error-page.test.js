// `zubra.errorPage(error)`: the answer to a request that failed, for an app's own `catch`. In
// development a page that says what went wrong (and, with `reload`, goes away when the fix is
// saved); in production "Something went wrong" and never the error's message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '../src/index.js';
import { createZubra as createEdge } from '../src/edge.js';

const components = mkdtempSync(join(tmpdir(), 'zubra-error-page-'));
writeFileSync(join(components, 'say-word.zb'), '<say-word>\n  <p>word</p>\n</say-word>\n');
test.after(() => rmSync(components, { recursive: true, force: true }));

// An error whose message would be markup, and would tell a visitor about the database.
const failure = () => new Error('select * from users where token = "<script>alert(1)</script>" & more');

test('development: a page with the message, escaped, and where it was thrown', () => {
  const failed = createZubra({ components, production: false }).errorPage(failure());
  assert.equal(failed.status, 500);
  assert.equal(failed.type, 'text/html; charset=utf-8');
  assert.match(failed.body, /^<!doctype html>/);
  assert.ok(failed.body.includes('<pre>select * from users where token = "&lt;script&gt;alert(1)&lt;/script&gt;" &amp; more</pre>'));
  assert.ok(!failed.body.includes('<script>alert'), 'nothing in the message runs');
  // The stack's frames, and only them (its first line is the message again).
  const frames = failed.body.match(/<pre>(\s+at [^]*?)<\/pre>/)?.[1];
  assert.ok(frames && frames.includes('error-page.test.js'), 'where it was thrown');
  assert.equal(failed.body.match(/select \*/g).length, 1);
  // Without `reload`, no script.
  assert.doesNotMatch(failed.body, /<script/);
});

test('development: a thrown value that is not an Error is said as it is, with no stack', () => {
  const failed = createZubra({ components, production: false }).errorPage('a <b>string</b>');
  assert.match(failed.body, /<pre>a &lt;b&gt;string&lt;\/b&gt;<\/pre><\/body>/);
  assert.equal(failed.body.match(/<pre>/g).length, 1);
});

test('development with `reload`: the page has the script, with the nonce, so it goes away when the fix is saved', () => {
  const zubra = createZubra({ components, production: false, reload: true });
  assert.match(zubra.errorPage(failure()).body, /<script src="\/_zubra\/reload\.js" async><\/script><\/body><\/html>$/);
  assert.match(zubra.errorPage(failure(), { nonce: 'n0nce' }).body, /<script src="\/_zubra\/reload\.js" async nonce="n0nce"><\/script>/);
  assert.throws(() => zubra.errorPage(failure(), { nonce: '"><script>' }), /nonce/, 'a nonce that cannot be one fails, as for a page');
});

test('development: readable on a phone and in dark mode, with a heading that names the file or the error', () => {
  const zubra = createZubra({ components, production: false });
  const { body } = zubra.errorPage(new TypeError('x is not a function'));
  assert.match(body, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(body, /color-scheme:light dark/);
  assert.match(body, /pre\{white-space:pre-wrap/);
  assert.match(body, /<title>TypeError<\/title>.*<h1>TypeError<\/h1><pre>x is not a function<\/pre>/s);
  // A component that doesn't compile: the heading is its file.
  writeFileSync(join(components, 'broken-one.zb'), '<broken-one>\n  <p>{oops(</p>\n</broken-one>\n');
  try {
    let thrown;
    try { createZubra({ components, production: false }).page().render('broken-one', {}); } catch (error) { thrown = error; }
    assert.ok(thrown, 'it fails');
    assert.match(zubra.errorPage(thrown).body, /<h1>Error in broken-one\.zb<\/h1>/);
  } finally {
    rmSync(join(components, 'broken-one.zb'));
  }
});

test('production: "Something went wrong", as plain text, and nothing of the error', () => {
  const failed = createZubra({ components, production: true, reload: true }).errorPage(failure());
  assert.deepEqual(failed, { status: 500, type: 'text/plain; charset=utf-8', body: 'Something went wrong' });
});

const wasmPath = fileURLToPath(import.meta.resolve('@zubra/compiler/zubra.wasm'));
const skip = existsSync(wasmPath) ? false : 'zubra.wasm is not built (npm run build in compiler)';

test('the edge entry has it too, and a Worker is production unless told otherwise', { skip }, () => {
  const wasm = new WebAssembly.Module(readFileSync(wasmPath));
  const sources = { 'say-word': '<say-word>\n  <p>word</p>\n</say-word>\n' };
  assert.equal(createEdge({ wasm, components: sources }).errorPage(failure()).body, 'Something went wrong');
  assert.match(createEdge({ wasm, components: sources, production: false }).errorPage(failure()).body, /&lt;script&gt;alert/);
});
