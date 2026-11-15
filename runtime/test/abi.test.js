// The compiled-code interface version: modules compiled for another runtime are refused with a
// message that says what to do. Runs in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { define, $define, $element, ABI } from '../src/index.js';

test('modules compiled for runtime 1.x, or another interface, are refused clearly', () => {
  assert.equal(ABI, 4);
  assert.throws(() => define('zb-old', { props: {}, setup: () => [] }), /<zb-old> was compiled for @zubra\/runtime 1\.x; recompile it with zubra 2/);
  assert.throws(() => $define('zb-other', { abi: 5 }), /interface 5, this runtime is 4/);
  assert.throws(() => $define('zb-none', {}), /interface 1, this runtime is 4/);
  // Interface 4 output calls $element, which reads only interface 4: its parts name their binders.
  assert.throws(() => $element('zb-three', { abi: 3 }), /interface 3, this runtime is 4/);
  assert.equal($element('zb-el', { abi: 4, props: {} }).zubra.tag, 'zb-el');
  // Modules compiled by 3.x and 4.x (interface 2) and by 5.0 to 5.16 (3) still run.
  assert.equal($define('zb-four', { abi: 2, props: {} }).zubra.tag, 'zb-four');
  assert.equal($define('zb-five', { abi: 3, props: {} }).zubra.tag, 'zb-five');
  // The current interface: without a DOM, a stand-in with the element's description.
  const Element = $define('zb-now', { abi: ABI, props: { a: { attribute: 'a', default: 1 } } });
  assert.equal(Element.zubra.tag, 'zb-now');
});
