// A component that fills a child's slot, where the child has that slot in more than one branch of
// a zb-if at different places: the server renders one branch, and the element takes over that
// markup whichever it was, its content bound where the child put it. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useBrowser, open, here, compiler, runtimeOnly } from './harness.js';

const fixture = (name) => join(here, `fixtures/${name}.zb`);
const fills = fixture('fills-branch-slot');
useBrowser(Object.fromEntries(['fills-branch-slot', 'branch-slot', 'fills-slot-swap', 'slot-swap', 'fills-slot-swap-tagged', 'slot-swap-tagged', 'frame-box', 'relay-box', 'fills-relay-box', 'relay-branch', 'fills-relay-branch', 'named-relay', 'fills-named-relay'].map((name) => [name, fixture(name)])));

let rendered = 0;
const server = (props, source = fills) => {
  const file = join(tmpdir(), `zb-branch-slot-${process.pid}-${rendered++}.json`);
  writeFileSync(file, JSON.stringify(props));
  return compiler(source, '--props', file, '--partial');
};

for (const [branch, props, inner] of [
  ['the first branch (a link)', { label: 'Go', href: '/next' }, 'a'],
  ['the second branch (a button, the slot after a spinner region)', { label: 'Go', href: '' }, 'button'],
  ['the second branch with its spinner shown', { label: 'Go', href: '', busy: true }, 'button'],
]) {
  test(`server markup with ${branch} is taken over, and its slotted content stays live`, { skip: runtimeOnly }, async () => {
    const { page, messages } = await open(server(props), {
      beforeModules: `window.serverInner = document.querySelector('fills-branch-slot ${inner}');`,
      modules: ['branch-slot', 'fills-branch-slot'],
    });
    const result = await page.evaluate(async (inner) => {
      const host = document.querySelector('fills-branch-slot');
      await host.updateComplete;
      const kept = host.querySelector(inner) === window.serverInner;
      host.label = 'Stop';
      await host.updateComplete;
      return { kept, text: host.querySelector(inner).textContent.trim() };
    }, inner);
    assert.deepEqual(result, { kept: true, text: props.busy ? '…Stop now' : 'Stop now' });
    assert.deepEqual(messages, []);
  });
}

// Another slot of the child at the same place in its other branch: content must never be bound to
// the other slot's nodes. Where the branches differ (a <p> and a <div>), the element tells which
// the server rendered; where they don't, the element renders fresh.
test('content for a slot that shares its place with another slot, by the same steps, is rendered fresh, never bound to the other', { skip: runtimeOnly }, async () => {
  const { page, messages } = await open(server({ a: 'A', b: 'B' }, fixture('fills-slot-swap')), {
    beforeModules: "window.serverInner = document.querySelector('fills-slot-swap i');",
    modules: ['slot-swap', 'fills-slot-swap'],
  });
  const result = await page.evaluate(async () => {
    const host = document.querySelector('fills-slot-swap');
    await host.updateComplete;
    const kept = host.querySelector('i') === window.serverInner;
    host.a = 'A2'; // the left slot's content: not shown (the server rendered the right branch)
    host.b = 'B2';
    await host.updateComplete;
    return { kept, shown: host.querySelector('slot-swap').textContent.trim() };
  });
  assert.deepEqual(result, { kept: false, shown: 'B2' });
  assert.ok(messages.every((message) => /doesn't match its template/.test(message)), messages.join('\n'));
});

for (const [branch, wide, kept] of [['its own branch', false, true], ['the other branch', true, false]]) {
  test(`content for a slot that shares its place with another slot in a different element: server markup with ${branch} is ${kept ? 'taken over' : 'rendered fresh'}`, { skip: runtimeOnly }, async () => {
    const { page } = await open(server({ b: 'B', wide }, fixture('fills-slot-swap-tagged')), {
      beforeModules: "window.serverInner = document.querySelector('fills-slot-swap-tagged slot-swap-tagged');",
      modules: ['slot-swap-tagged', 'fills-slot-swap-tagged'],
    });
    const result = await page.evaluate(async () => {
      const host = document.querySelector('fills-slot-swap-tagged');
      await host.updateComplete;
      const kept = host.querySelector('slot-swap-tagged') === window.serverInner;
      host.b = 'B2';
      host.wide = false;
      await host.updateComplete;
      return { kept, shown: host.querySelector('slot-swap-tagged').textContent.trim() };
    });
    assert.deepEqual(result, { kept, shown: 'B2' });
  });
}

// A slot a component forwards to a child of its own: content for it sits where that child puts it.
test('content for a slot its component forwards to another component is taken over where that one put it', { skip: runtimeOnly }, async () => {
  const { page, messages } = await open(server({ label: 'Go' }, fixture('fills-relay-box')), {
    beforeModules: "window.serverInner = document.querySelector('fills-relay-box b');",
    modules: ['frame-box', 'relay-box', 'fills-relay-box'],
  });
  const result = await page.evaluate(async () => {
    const host = document.querySelector('fills-relay-box');
    await host.updateComplete;
    const kept = host.querySelector('b') === window.serverInner;
    host.label = 'Stop';
    await host.updateComplete;
    return { kept, text: host.querySelector('b').textContent, count: host.querySelectorAll('b').length, framed: !!host.querySelector('.frame b') };
  });
  assert.deepEqual(result, { kept: true, text: 'Stop', count: 1, framed: true });
  assert.deepEqual(messages, []);
});

for (const [branch, framed, kept] of [['its own branch (forwarded)', true, true], ['the other branch (another slot at the same position)', false, false]]) {
  test(`content for a forwarded slot that shares its position with another slot: server markup with ${branch} is ${kept ? 'taken over' : 'rendered fresh'}`, { skip: runtimeOnly }, async () => {
    const { page } = await open(server({ label: 'Go', framed }, fixture('fills-relay-branch')), {
      beforeModules: "window.serverInner = document.querySelector('fills-relay-branch relay-branch');",
      modules: ['frame-box', 'relay-branch', 'fills-relay-branch'],
    });
    const result = await page.evaluate(async () => {
      const host = document.querySelector('fills-relay-branch');
      await host.updateComplete;
      const kept = host.querySelector('relay-branch') === window.serverInner;
      host.label = 'Stop';
      host.framed = true;
      await host.updateComplete;
      return { kept, text: host.querySelector('.frame b')?.textContent ?? null };
    });
    assert.deepEqual(result, { kept, text: 'Stop' });
  });
}

// #323: a named slot passed on to a child component's slot. Its content keeps its `slot="y"`
// (its name in <named-relay>), which <frame-box> has no slot for; the slot part says which of
// <frame-box>'s slots it is in, and the content is shown there.
const shown = (page, tag) => page.evaluate(async (tag) => {
  const host = document.querySelector(tag);
  await host.updateComplete;
  await new Promise((resolve) => setTimeout(resolve)); // the slot routers' observers
  return {
    framed: host.querySelector('.frame b')?.textContent ?? null,
    own: host.querySelector('p.own i')?.textContent ?? null,
    count: host.querySelectorAll('b').length,
  };
}, tag);

test('a named slot passed on to a child component shows its content there, in plain HTML', async () => {
  const { page, messages } = await open('<named-relay><b slot="y">B</b><i>own</i></named-relay>', { modules: ['frame-box', 'named-relay'] });
  assert.deepEqual(await shown(page, 'named-relay'), { framed: 'B', own: 'own', count: 1 });
  // Content added later goes there too, and content taken out of the slot leaves.
  const later = await page.evaluate(async () => {
    const host = document.querySelector('named-relay');
    const c = document.createElement('b');
    c.slot = 'y';
    c.textContent = 'C';
    host.appendChild(c);
    await new Promise((resolve) => setTimeout(resolve));
    const both = [...host.querySelectorAll('.frame b')].map((b) => b.textContent).join(' ');
    host.removeChild(host.querySelector('b'));
    await new Promise((resolve) => setTimeout(resolve));
    return { both, left: [...host.querySelectorAll('.frame b')].map((b) => b.textContent).join(' ') };
  });
  assert.deepEqual(later, { both: 'B C', left: 'C' });
  // Its `slot` changed: <named-relay> moves it to its own `z` slot, out of <frame-box> (by its
  // attribute: what it was passed on as is <frame-box>'s to read, not <named-relay>'s).
  const moved = await page.evaluate(async () => {
    const host = document.querySelector('named-relay');
    host.querySelector('.frame b').slot = 'z';
    await new Promise((resolve) => setTimeout(resolve));
    return { framed: host.querySelectorAll('.frame b').length, z: host.querySelector('span.z b')?.textContent ?? null, own: host.querySelectorAll('p.own b').length };
  });
  assert.deepEqual(moved, { framed: 0, z: 'C', own: 0 });
  assert.deepEqual(messages, []);
});

test('a named slot passed on to a child component, filled by a component: rendered fresh, and live', async () => {
  const { page, messages } = await open('<fills-named-relay></fills-named-relay>', { modules: ['frame-box', 'named-relay', 'fills-named-relay'] });
  assert.deepEqual(await shown(page, 'fills-named-relay'), { framed: 'Go', own: 'own', count: 1 });
  await page.evaluate(async () => { const host = document.querySelector('fills-named-relay'); host.label = 'Stop'; await host.updateComplete; });
  assert.deepEqual(await shown(page, 'fills-named-relay'), { framed: 'Stop', own: 'own', count: 1 });
  assert.deepEqual(messages, []);
});

test('a named slot passed on to a child component: server markup is taken over where the child put it', { skip: runtimeOnly }, async () => {
  const { page, messages } = await open(server({ label: 'Go' }, fixture('fills-named-relay')), {
    beforeModules: "window.serverInner = document.querySelector('fills-named-relay .frame b');",
    modules: ['frame-box', 'named-relay', 'fills-named-relay'],
  });
  const kept = await page.evaluate(async () => {
    const host = document.querySelector('fills-named-relay');
    await host.updateComplete;
    return !!window.serverInner && host.querySelector('.frame b') === window.serverInner;
  });
  assert.equal(kept, true);
  await page.evaluate(async () => { const host = document.querySelector('fills-named-relay'); host.label = 'Stop'; await host.updateComplete; });
  assert.deepEqual(await shown(page, 'fills-named-relay'), { framed: 'Stop', own: 'own', count: 1 });
  assert.deepEqual(messages, []);
});
