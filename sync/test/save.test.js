// The save effect of 'use collection', in Node: what a local edit writes, and what it costs. A
// component's setup is the browser's (browser.test.js); here `collection()` runs with the
// runtime's signals and effects and no element, so `onUnmount` is a no-op.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const shim = new URL('./runtime-without-elements.js', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, next) {
  if (specifier === '@zubra/runtime' && context.parentURL?.endsWith('/sync/src/index.js')) return { url: ${JSON.stringify(shim)}, shortCircuit: true };
  return next(specifier, context);
}`)}`);
const { Signal, flush } = await import('@zubra/runtime/core');
const sync = await import('../src/index.js');

const stored = new Map();
sync.configure({ store: { get: async (collection, key) => stored.get(`${collection}/${key}`), set: async (collection, key, fields) => void stored.set(`${collection}/${key}`, fields) } });
const settle = async () => {
  flush();
  await new Promise((done) => setTimeout(done, 0));
  flush();
};

test('a local edit writes only the field that changed, and the others are not serialised again', async () => {
  let serialised = 0;
  // A big field: its toJSON counts each time the save effect writes it out.
  const items = { list: [1, 2, 3], toJSON() { serialised += 1; return this.list; } };
  const fields = { items: new Signal.State(items), title: new Signal.State('a') };
  sync.collection('lists', ['doc'], { doc: 'one' }, fields);
  await new Promise((done) => setTimeout(done, 20));
  await settle();
  const writes = [];
  const stop = sync.onWrite((collection, key, changed) => writes.push({ collection, key, changed }));
  try {
    const before = serialised;
    for (const title of ['b', 'c', 'd']) {
      fields.title.set(title);
      await settle();
    }
    assert.deepEqual(writes.map(({ changed }) => changed), [{ title: 'b' }, { title: 'c' }, { title: 'd' }]);
    assert.equal(serialised, before, 'the untouched field is written from its kept JSON');
    assert.deepEqual(stored.get('lists/one'), { items: [1, 2, 3], title: 'd' });
    // Setting a field to what it already holds writes nothing.
    fields.title.set('d');
    await settle();
    assert.equal(writes.length, 3);
    // The big field changing is written, once.
    fields.items.set({ list: [4], toJSON() { serialised += 1; return this.list; } });
    await settle();
    assert.deepEqual(writes.at(-1).changed, { items: [4] });
    assert.equal(serialised, before + 1);
  } finally {
    stop();
  }
});
