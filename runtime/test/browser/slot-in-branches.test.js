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
useBrowser(Object.fromEntries(['fills-branch-slot', 'branch-slot', 'fills-slot-swap', 'slot-swap', 'fills-slot-swap-tagged', 'slot-swap-tagged'].map((name) => [name, fixture(name)])));

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
