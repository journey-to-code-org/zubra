// A component that fills a child's slot, where the child has that slot in more than one branch of
// a zb-if at different places: the server renders one branch, and the element takes over that
// markup whichever it was, its content bound where the child put it. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useBrowser, open, here, compiler, runtimeOnly } from './harness.js';

const fills = join(here, 'fixtures/fills-branch-slot.zb');
useBrowser({ 'fills-branch-slot': fills, 'branch-slot': join(here, 'fixtures/branch-slot.zb') });

const server = (props) => {
  const file = join(tmpdir(), `zb-branch-slot-${Object.values(props).join('-').replace(/\W/g, '')}.json`);
  writeFileSync(file, JSON.stringify(props));
  return compiler(fills, '--props', file, '--partial');
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
