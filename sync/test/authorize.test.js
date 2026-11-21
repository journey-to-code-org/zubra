// Who may read and write: without `authorize`, pages have no access. With it,
// each change is asked with its field and value (S6), so an app can keep fields for the server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncServer, allowAnyone, allowReads } from '../src/server.js';
import { syncObject } from '../src/durable-core.js';
import { durableStorage } from './durable-storage.js';
import { binaryPath, startBinary } from './backends.js';
import { sqliteLog } from '../src/sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const clock = (n) => `00000000000000${n}-00000-dev1`;
const change = (field, value, n = 1, collection = 'tasks') => ({ collection, key: 't1', field, value, clock: clock(n) });
const post = (sync, path, body) =>
  sync.fetch(new Request(`http://localhost/_zb/sync/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
const pull = async (sync) => (await sync.fetch(new Request('http://localhost/_zb/sync/pull?since=0'))).json();
const room = { room: 'tasks/t1', peer: 'p1', state: { name: 'Ada' } };
const signal = { room: 'tasks/t1', from: 'p1', to: 'p2', data: { sdp: 'x' } };
/** Open p1's live stream (a signal must come from a peer with one) and read its key from `hello`. */
async function liveKey(response) {
  const reader = response.body.getReader();
  let text = '';
  while (!/event: hello\ndata: (.*)\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  return { key: JSON.parse(/event: hello\ndata: (.*)\n\n/.exec(text)[1]).key, close: () => reader.cancel().catch(() => {}) };
}

test('without authorize, a page may not push, join or signal, and is told why', async () => {
  const sync = createSyncServer();
  const pushed = await post(sync, 'push', { changes: [change('title', 'free beef')] });
  assert.equal(pushed.status, 403);
  assert.match((await pushed.json()).error, /takes no reads or writes from pages.*pass createSyncServer\(\{ authorize \}\)/);
  assert.equal((await sync.fetch(new Request('http://localhost/_zb/sync/pull?since=0'))).status, 403);
  assert.equal((await sync.documents()).get('tasks', 't1'), undefined);
  assert.equal((await post(sync, 'push', { changes: [] })).status, 403, 'even an empty push needs authorization');
  for (const [path, body] of [['presence', room], ['signal', signal]]) {
    const answer = await post(sync, path, body);
    assert.equal(answer.status, 403, path);
    assert.match((await answer.json()).error, /authorize/, path);
  }
});

test('allowReads: the collections it names are read, others not, and pages write nothing', async () => {
  const sync = createSyncServer({ authorize: allowReads(['tasks']), warn: false });
  await sync.write('tasks', 't1', { title: 'shown' });
  await sync.write('salaries', 'ada', { amount: 1 });
  assert.deepEqual((await pull(sync)).changes.map((one) => [one.collection, one.value]), [['tasks', 'shown']]);
  const pushed = await post(sync, 'push', { changes: [change('title', 'no')] });
  assert.equal(pushed.status, 403);
  assert.match((await pushed.json()).error, /takes no writes from pages/);
  // With no list, every collection; and only a list of names is taken.
  const all = createSyncServer({ authorize: allowReads() });
  await all.write('tasks', 't1', { title: 'shown' });
  await all.write('salaries', 'ada', { amount: 1 });
  assert.equal((await pull(all)).changes.length, 2);
  assert.equal((await post(all, 'push', { changes: [change('title', 'no')] })).status, 403);
  assert.throws(() => allowReads('tasks'), /a list of collection names/);
});

test('without authorize, pull and live do not expose server-written data', async () => {
  const sync = createSyncServer();
  await sync.write('tasks', 'private', { title: 'secret' });
  for (const path of ['pull?since=0', 'live?since=0&peer=p1']) {
    const response = await sync.fetch(new Request(`http://localhost/_zb/sync/${path}`));
    assert.equal(response.status, 403, path);
    assert.match((await response.json()).error, /authorize/);
  }
  assert.equal((await sync.documents()).get('tasks', 'private').title, 'secret');
});

test('allowAnyone opens writes to every page', async () => {
  const sync = createSyncServer({ authorize: allowAnyone });
  assert.equal((await post(sync, 'push', { changes: [change('title', 'a')] })).status, 200);
  const p1 = await liveKey(await sync.fetch(new Request('http://localhost/_zb/sync/live?since=0&peer=p1')));
  assert.equal((await post(sync, 'presence', { ...room, key: p1.key })).status, 200);
  assert.equal((await post(sync, 'signal', { ...signal, key: p1.key })).status, 200);
  p1.close();
  assert.equal((await sync.documents()).get('tasks', 't1').title, 'a');
});

test("authorize is asked each change's field and value, so fields can be the server's alone", async () => {
  const asked = [];
  const sync = createSyncServer({
    authorize: (from) => {
      if (from.kind === 'change') asked.push([from.collection, from.key, from.field, from.value, from.write]);
      return from.kind !== 'change' || (from.collection === 'tasks' && from.field !== 'price');
    },
  });
  assert.equal((await post(sync, 'push', { changes: [change('title', 'a'), change('done', true, 2)] })).status, 200);
  assert.deepEqual(asked, [['tasks', 't1', 'title', 'a', true], ['tasks', 't1', 'done', true, true]]);
  const refused = await post(sync, 'push', { changes: [change('title', 'b', 3), change('price', 5, 4)] });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, 'Not yours to change', "an app's own refusal keeps its wording");
  assert.equal((await sync.documents()).get('tasks', 't1').title, 'a', 'all or nothing: the title in the same push was refused too');
  assert.equal((await post(sync, 'push', { changes: [change('qty', 1, 5, 'payments')] })).status, 403, 'a whole collection can be the server\'s');
});

test('authorize must be a function', () => {
  assert.throws(() => createSyncServer({ authorize: true }), /`authorize` is a function/);
  assert.throws(() => createSyncServer({ authorize: 'anyone' }), /`authorize` is a function/);
});

test('a Durable Object without an authorize refuses reads and writes; with one, it decides', async () => {
  const bare = syncObject({ storage: durableStorage() }, {});
  const pushed = await post(bare, 'push', { changes: [change('title', 'x')] });
  assert.equal(pushed.status, 403);
  assert.match((await pushed.json()).error, /authorize/);
  await bare.write('tasks', 't1', { title: 'server' });
  assert.equal((await bare.fetch(new Request('http://localhost/_zb/sync/pull?since=0'))).status, 403);
  assert.equal((await bare.documents()).get('tasks', 't1').title, 'server', "the server's own writes still work");
  const reading = syncObject({ storage: durableStorage() }, { authorize: allowReads(['tasks']) });
  await reading.write('tasks', 't1', { title: 'server' });
  assert.equal((await pull(reading)).changes.length, 1, 'reads opened by options.authorize');

  const open = syncObject({ storage: durableStorage() }, { authorize: ({ field }) => field !== 'secret' });
  assert.equal((await post(open, 'push', { changes: [change('title', 'x')] })).status, 200);
  assert.equal((await post(open, 'push', { changes: [change('secret', 'x', 2)] })).status, 403, "the object's authorize sees the field");
});

test('the zubra-sync binary refuses reads unless started with --open', { skip: !binaryPath && 'binary not built' }, async () => {
  const { base, close } = await startBinary();
  try {
    for (const path of ['pull?since=0', 'live?since=0&peer=p1']) {
      const response = await fetch(`${base}/_zb/sync/${path}`);
      assert.equal(response.status, 403, path);
      assert.match((await response.json()).error, /--open/);
    }
  } finally {
    close();
  }
});

test('the zubra-sync binary takes no page requests unless started with --open', { skip: !binaryPath && 'binary not built' }, async () => {
  for (const [args, status] of [[[], 403], [['--open'], 200]]) {
    const { base, close } = await startBinary(args);
    try {
      const send = (path, body) => fetch(`${base}/_zb/sync/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const pushed = await send('push', { changes: [change('title', 'x')] });
      assert.equal(pushed.status, status, `push ${args.join(' ') || '(closed)'}`);
      if (status === 403) assert.match((await pushed.json()).error, /start zubra-sync with --open/);
      const live = await fetch(`${base}/_zb/sync/live?since=0&peer=p1`);
      assert.equal(live.status, status);
      const p1 = status === 200 ? await liveKey(live) : { key: '', close: () => {} };
      assert.equal((await send('presence', { ...room, key: p1.key })).status, status, `presence ${args.join(' ') || '(closed)'}`);
      assert.equal((await send('signal', { ...signal, key: p1.key })).status, status, `signal ${args.join(' ') || '(closed)'}`);
      p1.close();
      const response = await fetch(`${base}/_zb/sync/pull?since=0`);
      assert.equal(response.status, status);
      if (status === 200) assert.equal((await response.json()).changes.length, 1);
    } finally {
      close();
    }
  }
});

test('the zubra-sync binary lets pages read nothing unless told: --read <collection>, --read-all or --open', { skip: !binaryPath && 'binary not built' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-sync-reads-'));
  const path = join(dir, 'reads.db');
  try {
    const log = await sqliteLog(path);
    await log.append([change('title', 'a task'), change('amount', 1, 2, 'salaries')]);
    log.close();
    for (const [args, seen] of [[[], []], [['--read', 'tasks'], ['tasks']], [['--read', 'tasks', '--read', 'salaries'], ['tasks', 'salaries']], [['--read-all'], ['tasks', 'salaries']], [['--open'], ['tasks', 'salaries']]]) {
      const { base, close, stopped } = await startBinary([...args, '--db', path]);
      try {
        const response = await fetch(`${base}/_zb/sync/pull?since=0`);
        if (!args.length) {
          assert.equal(response.status, 403, 'pull (closed)');
          assert.match((await response.json()).error, /--open/);
          const live = await fetch(`${base}/_zb/sync/live?since=0&peer=p1`);
          assert.equal(live.status, 403, 'live (closed)');
          assert.match((await live.json()).error, /--open/);
          continue;
        }
        assert.equal(response.status, 200, `pull ${args.join(' ')}`);
        const read = await response.json();
        assert.deepEqual(read.changes.map((one) => one.collection), seen, args.join(' ') || '(closed)');
        // The live stream's backlog too.
        const live = await fetch(`${base}/_zb/sync/live?since=0&peer=p1`);
        assert.equal(live.status, 200, `live ${args.join(' ')}`);
        const reader = live.body.getReader();
        let text = '';
        while (!/event: changes\ndata: .*\n\n/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
        reader.cancel().catch(() => {});
        assert.deepEqual(JSON.parse(/event: changes\ndata: (.*)\n\n/.exec(text)[1]).changes.map((one) => one.collection), seen, `live ${args.join(' ') || '(closed)'}`);
        // Reading opens no writes.
        if (!args.includes('--open')) assert.equal((await fetch(`${base}/_zb/sync/push`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ changes: [change('title', 'x', 3)] }) })).status, 403);
      } finally {
        close();
        await stopped;
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a live page's read is asked once per document in a batch, not once per change", { timeout: 5000 }, async () => {
  let reads = 0;
  const sync = createSyncServer({ authorize: ({ kind }) => (kind === 'read' && reads++, true) });
  const response = await sync.fetch(new Request('http://shop/_zb/sync/live?since=0&peer=p1'));
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('event: changes')) text += new TextDecoder().decode((await reader.read()).value);
  reads = 0;
  await sync.write('tasks', 't1', Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`f${i}`, i])));
  while (!text.includes('"f49"')) text += new TextDecoder().decode((await reader.read()).value);
  assert.equal(reads, 1);
  await reader.cancel();
});
