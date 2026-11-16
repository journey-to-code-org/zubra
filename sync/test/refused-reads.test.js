// A collection whose every read is refused looks, to a page, exactly like an empty one. In
// development the server says so once, to whoever runs it; the page is told nothing more.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncServer, allowAnyone } from '../src/server.js';

let n = 0;
const at = () => `${String(++n).padStart(15, '0')}-00000-dev1`;
const change = (collection, key, value) => ({ collection, key, field: 'v', value, clock: at() });
const url = (path, scope) => `http://shop/_zb/sync${path}${scope === undefined ? '' : `&scope=${encodeURIComponent(JSON.stringify(scope))}`}`;
const pull = async (sync, { since = '0', scope, headers = {} } = {}) => (await sync.fetch(new Request(url(`/pull?since=${since}`, scope), { headers }))).json();

async function server(options) {
  const warned = [];
  const sync = createSyncServer({ warn: (message) => warned.push(message), ...options });
  await sync.write('secrets', 'a', { left: 2 });
  await sync.write('secrets', 'b', { left: 3 });
  await sync.write('items', 'bun', { left: 5 });
  return { sync, warned };
}

test('authorize refusing every read of a collection is said once, with the collection, the request and the cause', async () => {
  const { sync, warned } = await server({ authorize: ({ collection, write }) => !write && collection !== 'secrets' });
  const body = await pull(sync);
  assert.deepEqual([...new Set(body.changes.map((each) => each.collection))], ['items'], 'the page gets what it may see, and no word of the rest');
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^@zubra\/sync: a page read "secrets" \(GET \/_zb\/sync\/pull\) and was sent none of its 2 documents: `authorize` refused every read\./);
  assert.match(warned[0], /`warn: false` turns it off/);
  await pull(sync);
  assert.equal(warned.length, 1, 'once per collection');
});

test("the server's scope leaving a collection out is said as that", async () => {
  const { sync, warned } = await server({ scope: () => ({ items: true, secrets: 'mine/' }) });
  await pull(sync);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /a page read "secrets" .* none of its 2 documents: the server's `scope` for that request leaves them all out/);
});

test('nothing is said when the page sees some of a collection, left it out of its own scope, or only read what is new', async () => {
  // Some of it: one document of two.
  const some = await server({ authorize: ({ key, write }) => !write && key !== 'a' });
  await pull(some.sync);
  assert.deepEqual(some.warned, []);
  // The page's own scope doesn't ask for the collection.
  const narrow = await server({ authorize: ({ collection, write }) => !write && collection !== 'secrets' });
  await pull(narrow.sync, { scope: { items: true } });
  assert.deepEqual(narrow.warned, []);
  // A later batch: other people's changes are refused as a matter of course.
  const later = await server({ authorize: ({ request, write }) => !write && request.headers.get('x-user') === 'ada' });
  const first = await pull(later.sync, { headers: { 'x-user': 'ada' } });
  await later.sync.write('secrets', 'c', { left: 1 });
  const grace = await pull(later.sync, { since: first.cursor });
  assert.deepEqual([grace.changes.length, later.warned], [0, []]);
  // Everything allowed.
  const open = await server({ authorize: allowAnyone });
  await pull(open.sync);
  assert.deepEqual(open.warned, []);
});

test('the live stream read from the start says the same, once', async () => {
  const { sync, warned } = await server({ authorize: ({ collection, write }) => !write && collection !== 'secrets' });
  const response = await sync.fetch(new Request(url('/live?since=0&peer=p1')));
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('event: changes')) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(warned.length, 1);
  assert.match(warned[0], /a page read "secrets" \(GET \/_zb\/sync\/live\)/);
});

test('`warn: false`, and production by default, say nothing', async () => {
  const off = createSyncServer({ warn: false, authorize: ({ write }) => !write && false });
  await off.write('secrets', 'a', { left: 2 });
  assert.deepEqual((await pull(off)).changes, []);
  const said = [];
  const { warn } = console;
  const env = process.env.NODE_ENV;
  console.warn = (message) => said.push(message);
  try {
    process.env.NODE_ENV = 'production';
    const production = createSyncServer({ authorize: () => false });
    await production.write('secrets', 'a', { left: 2 });
    await pull(production);
    assert.deepEqual(said, []);
    // And in development, with no `warn` given, it goes to the console.
    process.env.NODE_ENV = 'development';
    const development = createSyncServer({ authorize: () => false });
    await development.write('secrets', 'a', { left: 2 });
    await pull(development);
    assert.equal(said.length, 1);
  } finally {
    console.warn = warn;
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
  }
});
