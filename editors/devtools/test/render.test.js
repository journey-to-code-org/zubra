// The pane's rendering, from readings shaped as runtime/src/devtools.js returns them. (The pane
// against a live page is tested in runtime/test/browser/devtools.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../render.js';

const reading = {
  version: 1,
  native: false,
  update: 3,
  component: { tag: 'dt-panel', file: '/app/src/dt-panel.zb', at: { line: 8, column: 1 }, located: true },
  props: [{ name: 'label', value: '"Panel"' }],
  state: [{ name: 'count', value: '1' }, { name: 'items', value: '[{text: "<b>", done: false}]' }],
  bindings: [
    { operation: 'textContent = …', target: '<p.double>', at: { line: 11, column: 21 }, dependsOn: ['doubled'], ranLast: true, here: true },
    { operation: "classList.toggle('done', …)", target: '<li>', at: { line: 14, column: 11 }, dependsOn: ['items[0].done'], ranLast: false, here: false },
  ],
  setBy: null,
  lastUpdate: { number: 3, written: ['count'], ran: 1 },
};

test('a component: its file and line, props, state, and the bindings on the node first', () => {
  const html = render(reading);
  assert.match(html, /<h1><code>&lt;dt-panel&gt;<\/code><\/h1>/);
  assert.match(html, /data-file="\/app\/src\/dt-panel.zb" data-line="8" data-column="1"[^>]*>dt-panel.zb:8</);
  assert.match(html, /<dt>label<\/dt><dd><code>&quot;Panel&quot;<\/code>/);
  const onNode = html.indexOf('On this node');
  const all = html.indexOf('All bindings (2)');
  assert.ok(onNode > 0 && all > onNode);
  assert.ok(html.indexOf('textContent = …') < all, 'the node\'s own binding is in its section');
  assert.match(html, /data-line="11" data-column="21"[^>]*>line 11</);
  assert.match(html, /reads <code>doubled<\/code>/);
  assert.match(html, /class="ran"/);
  assert.match(html, /update 3: wrote <code>count<\/code>, 1 of this component's bindings re-ran/);
  assert.match(html, /Signals: polyfill/);
});

test('page values are escaped', () => {
  const html = render(reading);
  assert.ok(!html.includes('<b>'), html);
  assert.match(html, /&lt;b&gt;/);
});

test("a page's numbers are written as numbers, so a page can't put markup in the pane through them", () => {
  // The reading comes from the inspected page, whose script can return anything (security
  // audit 4): where the pane expects a line or a count, a string of markup is not written.
  const markup = '"><img src=x onerror=alert(1)>';
  const html = render({
    ...reading,
    component: { ...reading.component, at: { line: markup, column: markup } },
    bindings: [{ ...reading.bindings[0], at: { line: markup, column: markup } }],
    lastUpdate: { number: markup, written: ['count'], ran: markup },
  });
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('onerror'), html);
  assert.match(html, /data-line="NaN"/);
});

test('an unlocated component (an ordinary build) says how to get lines', () => {
  const html = render({
    ...reading,
    component: { tag: 'dt-plain', file: null, at: null, located: false },
    state: [],
    bindings: [{ operation: "addEventListener('click', …)", target: '<button>', at: null, dependsOn: [], ranLast: false, here: true }],
  });
  assert.match(html, /not located/);
  assert.match(html, /no line/);
  assert.match(html, /Names need a --devtools build/);
  assert.ok(!html.includes('data-file'), 'nothing to open');
});

test('what a parent binds onto a child component', () => {
  const html = render({
    ...reading,
    bindings: [],
    setBy: { tag: 'dt-panel', file: '/app/src/dt-panel.zb', bindings: [{ operation: '.value = …', target: '<dt-badge>', at: { line: 17, column: 13 }, dependsOn: ['count'], ranLast: false, here: true }] },
  });
  assert.match(html, /Set by <code>&lt;dt-panel&gt;<\/code>/);
  assert.match(html, /data-file="\/app\/src\/dt-panel.zb" data-line="17"/);
});

test('the other states: no runtime, connecting, outside a component, another version, an error', () => {
  assert.match(render({ missing: true }), /No Zubra development runtime/);
  assert.match(render(undefined), /No Zubra development runtime/);
  assert.match(render({ loading: true }), /Connecting/);
  assert.match(render({ version: 1, component: null }), /Not inside a Zubra component/);
  assert.match(render({ version: 2, component: null }), /speaks DevTools version 2/);
  assert.match(render({ error: 'x is not defined' }), /Couldn't read the page: x is not defined/);
});

test('the engine: Zubra\'s own, TC39 Signals native or not, and an older runtime\'s wording', () => {
  assert.match(render({ ...reading, engine: 'zubra' }), /Zubra's engine/);
  assert.match(render({ ...reading, engine: 'tc39', native: true }), /TC39 Signals, native <code>Signal<\/code>/);
  assert.match(render({ ...reading, engine: 'tc39', native: false }), /TC39 Signals, Zubra's implementation/);
  assert.match(render(reading), /Signals: polyfill/, 'a runtime from before 6.0 says only native or not');
});

test('why a binding re-ran: the signals behind it that changed, or that it has no name', () => {
  const with_ = (because) => render({ ...reading, bindings: [{ ...reading.bindings[0], because }] });
  assert.match(with_(['doubled ← count']), /re-ran because <code>doubled ← count<\/code> changed/);
  assert.match(with_([]), /re-ran: what changed has no name here/);
  assert.ok(!/re-ran because|no name here/.test(render(reading)), 'an older runtime gives no cause: nothing is said');
  assert.ok(!/re-ran because|no name here/.test(render({ ...reading, bindings: [{ ...reading.bindings[1], because: [] }] })), 'only for one that ran');
});

test("the component's signals: value, how often it changed, what reads it and what it reads", () => {
  const html = render({
    ...reading,
    signals: [
      { name: 'count', kind: 'state', value: '2', changes: 2, reads: [], readBy: ['textContent = … on <button.inc>', 'doubled'], readers: 2 },
      { name: 'doubled', kind: 'computed', value: '4', changes: null, reads: ['count'], readBy: ['textContent = … on <p.double>'], readers: 14 },
      { name: 'label', kind: 'prop', value: '"<b>"', changes: 0, reads: [], readBy: [], readers: 0 },
    ],
  });
  assert.match(html, /Signals \(3\)/);
  assert.match(html, /<code>count<\/code><span class="kind">state<\/span><span[^>]*>changed 2×/);
  assert.match(html, /read by <code>textContent = … on &lt;button.inc&gt;<\/code>, <code>doubled<\/code>/);
  assert.match(html, /<code>doubled<\/code><span class="kind">computed<\/span><\/div>/, 'no count where the engine keeps none');
  assert.match(html, /reads <code>count<\/code>/);
  assert.match(html, /and 13 more/);
  assert.match(html, /read by nothing live/);
  assert.match(html, /&quot;&lt;b&gt;&quot;/);
  assert.ok(!html.includes('<b>'));
  assert.ok(!/Signals \(/.test(render(reading)), 'an older runtime: no section');
});

test('live counts: in the component and on the page, with the trend and a line of it', () => {
  const history = (counts) => counts.map((effects, i) => ({ update: i + 1, effects }));
  const html = render({ ...reading, live: { component: 12, page: 3214, owners: 4000, components: 31, history: history([2000, 2214, 2500, 3000, 3214]) } });
  assert.match(html, /12 effects in this component · 31 components on the page · 3,214 effects alive of those made since the pane connected/);
  assert.match(html, /\+1,214 over the last 4 updates/);
  assert.match(html, /only grown/);
  assert.match(html, /<svg class="spark"[^>]*><polyline points="0.0,18.0 [^"]+ 100.0,2.0"\/>/);
  const settled = render({ ...reading, live: { component: 1, page: 9, owners: 9, components: 1, history: history([9, 12, 9]) } });
  assert.match(settled, /unchanged over the last 2 updates/);
  assert.ok(!/only grown/.test(settled));
  assert.match(settled, /· 1 component on the page ·/);
  assert.ok(!/only grown/.test(render({ ...reading, live: { component: 1, page: 12, owners: 9, components: 1, history: history([9, 12]) } })), 'two updates are too few to call');
});

test('the timeline: newest first, what each wrote and re-ran, and how long it took', () => {
  const html = render({
    ...reading,
    timeline: [
      { number: 7, took: 0.4, writes: 1, written: [{ name: '<dt-panel> count', from: '0', to: '1' }], ran: 2, reran: ['<dt-panel> textContent = … on <p>', '<dt-badge> .value = …'] },
      { number: 8, took: 1.25, writes: 23, written: [{ name: null, from: null, to: '"<i>"' }], ran: 9, reran: Array.from({ length: 9 }, (_, i) => `effect ${i}`) },
    ],
  });
  assert.match(html, /Updates \(2\)/);
  assert.ok(html.indexOf('<b>8</b>') < html.indexOf('<b>7</b>'), 'newest first');
  assert.match(html, /<b>7<\/b><span class="quiet">0.4 ms/);
  assert.match(html, /wrote <code>&lt;dt-panel&gt; count<\/code> <code>0<\/code> → <code>1<\/code>/);
  assert.match(html, /wrote <code>an unnamed signal<\/code> → <code>&quot;&lt;i&gt;&quot;<\/code>, and 22 more/);
  assert.match(html, /re-ran 9: <code>effect 0<\/code>.*<code>effect 5<\/code>, and 3 more/);
  assert.ok(!html.includes('<i>'));
});
