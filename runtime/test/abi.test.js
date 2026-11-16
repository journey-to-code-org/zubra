// The compiled-code interface version: modules compiled for another runtime are refused with a
// message that says what to do. Runs in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { define, $define, $element, $component, ABI } from '../src/index.js';

test('modules compiled for runtime 1.x, or another interface, are refused clearly', () => {
  assert.equal(ABI, 5);
  assert.throws(() => define('zb-old', { props: {}, setup: () => [] }), /<zb-old> was compiled for @zubra\/runtime 1\.x; recompile it with zubra 2/);
  assert.throws(() => $define('zb-other', { abi: 6 }), /interface 6, this runtime is 5/);
  assert.throws(() => $define('zb-none', {}), /interface 1, this runtime is 5/);
  // Interface 5 output calls $component, which reads only interface 5: its parts and definition
  // name what they need.
  assert.throws(() => $component('zb-four-only', { abi: 4 }), /interface 4, this runtime is 5/);
  assert.equal($component('zb-el', { abi: 5, props: {} }).zubra.tag, 'zb-el');
  // Interface 4 output (5.17 to 5.19.0) calls $element, which fills in what 5.17 and 5.18 didn't
  // name, as $define does.
  assert.equal($element('zb-el4', { abi: 4, props: {} }).zubra.tag, 'zb-el4');
  assert.throws(() => $element('zb-other4', { abi: 6 }), /interface 6, this runtime is 5/);
  // Modules compiled by 3.x and 4.x (interface 2) and by 5.0 to 5.16 (3) still run.
  assert.equal($define('zb-four', { abi: 2, props: {} }).zubra.tag, 'zb-four');
  assert.equal($define('zb-five', { abi: 3, props: {} }).zubra.tag, 'zb-five');
  // The current interface: without a DOM, a stand-in with the element's description.
  const Element = $define('zb-now', { abi: ABI, props: { a: { attribute: 'a', default: 1 } } });
  assert.equal(Element.zubra.tag, 'zb-now');
});
