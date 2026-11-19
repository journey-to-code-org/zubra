// A component that doesn't compile when the server starts. In development the server starts
// without it (a half-written file is the usual state of a file being edited); in production,
// and in `zubra-actions build`, it is an error.
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActions } from '../src/index.js';
import { serverHalves } from '../src/compile.js';

// Inside the package, so the server halves find what they import.
const work = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-broken-'));
after(() => rmSync(work, { recursive: true, force: true }));
const components = join(work, 'components');
mkdirSync(join(components, 'forms'), { recursive: true });
writeFileSync(join(components, 'guest-book.zb'), "<script>\n  export async function sign(form) {\n    'use server'\n    return { name: form.get('name') }\n  }\n</script>\n<guest-book>\n  <form action={sign}><input name=\"name\"><button>Sign</button></form>\n</guest-book>\n");
// An unclosed tag, and a script that stops mid-line: both with a function the server would run.
writeFileSync(join(components, 'forms/half-done.zb'), "<script>\n  export async function save(form) {\n    'use server'\n    return 1\n  }\n</script>\n<half-done>\n  <form action={save}><output>\n</half-done>\n");
writeFileSync(join(components, 'mid-line.zb'), "<script>\n  const total = 1 +\n</script>\n<mid-line>\n  <p>{total}</p>\n</mid-line>\n");

test('development: the server starts, the rest are served, and each broken file is named with its error', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    const actions = await createActions({ components, cacheDir: join(work, 'cache-dev'), production: false });
    assert.deepEqual(actions.routes(), ['/_zb/action/guest-book/sign']);
    const body = new FormData();
    body.append('name', 'Ada');
    const response = await actions.fetch(new Request('http://localhost/_zb/action/guest-book/sign', { method: 'POST', body, headers: { accept: 'application/json' } }));
    assert.deepEqual(await response.json(), { name: 'Ada' });

    const said = warn.mock.calls.map((call) => call.arguments[0]);
    assert.equal(said.length, 2);
    assert.match(said[0], /^@zubra\/actions: forms[\\/]half-done\.zb doesn't compile, so its server functions aren't served until it does and the server restarts\.\n/);
    assert.match(said[0], /closing tag <\/half-done> does not match <output>/);
    assert.match(said[0], /half-done\.zb:9:1/);
    assert.match(said[1], /^@zubra\/actions: mid-line\.zb doesn't compile/);
    assert.match(said[1], /invalid <script>/);
  } finally {
    warn.mock.restore();
  }
});

test('production: a component that doesn\'t compile stops the server from starting', async () => {
  const warn = mock.method(console, 'warn', () => {});
  try {
    await assert.rejects(createActions({ components, cacheDir: join(work, 'cache-prod'), production: true }), /closing tag <\/half-done> does not match <output>/);
    assert.equal(warn.mock.callCount(), 0);
  } finally {
    warn.mock.restore();
  }
});

test('the build is as strict as production', async () => {
  await assert.rejects(serverHalves(components), /closing tag <\/half-done> does not match <output>/);
});
