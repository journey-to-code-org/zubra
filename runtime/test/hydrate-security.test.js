import { test } from 'node:test';
import assert from 'node:assert/strict';
import { $hydrate } from '../src/hydrate.js';

function Host() {}
Object.defineProperty(Host.prototype, 'firstChild', {
  get() { return Object.getOwnPropertyDescriptor(this, 'firstChild')?.value ?? null; },
});
globalThis.Node = Host;

function text(data, next = null) {
  return { nodeType: 3, data, nextSibling: next, firstChild: null };
}

function el(name, { text: value = '', attrs = {} } = {}) {
  const attributes = new Map(Object.entries(attrs));
  const node = {
    nodeType: 1,
    localName: name,
    nextSibling: null,
    firstChild: value === '' ? null : text(value),
    get attributes() { return [...attributes].map(([attr, attrValue]) => ({ name: attr, value: attrValue })); },
    getAttribute: (attr) => attributes.get(attr) ?? null,
    setAttribute(attr, attrValue) { attributes.set(attr, attrValue); },
    removeAttribute(attr) { attributes.delete(attr); },
  };
  return node;
}

function pi(data, next = null) {
  return { nodeType: 7, target: 'zb', data, nextSibling: next, firstChild: null };
}

function chain(nodes) {
  for (let index = 0; index < nodes.length - 1; index++) nodes[index].nextSibling = nodes[index + 1];
  return { nodeType: 1, localName: 'div', firstChild: nodes[0] ?? null, nextSibling: null, attributes: [], getAttribute: () => null, setAttribute() {}, removeAttribute() {} };
}

test('an early slot close is not adopted, so the next control is not the visitor\'s link', () => {
  const template = chain([pi('[!'), pi(']'), el('button', { text: 'Delete', attrs: { type: 'button' } })]);
  const live = chain([pi('[!'), pi(']'), el('a', { text: 'Win a prize', attrs: { href: 'https://evil.example/phish' } }), pi(']'), el('button', { text: 'Delete', attrs: { type: 'button' } })]);
  const [nodes] = $hydrate.adopt(live, template, [{ path: [1], on: 'click', handler: () => () => {} }], false, []);
  assert.equal(nodes, null);
});

test('a lookalike child with different text is not adopted, and an extra URL attribute is removed when the text matches', () => {
  const template = chain([el('button', { text: 'Delete', attrs: { type: 'button' } })]);
  const hostile = chain([el('button', { text: 'Win a prize', attrs: { type: 'button', formaction: 'https://evil.example/post' } })]);
  assert.equal($hydrate.adopt(hostile, template, [{ path: [0], on: 'click', handler: () => () => {} }], false, [])[0], null);
  const button = el('button', { text: 'Delete', attrs: { type: 'button', formaction: 'https://evil.example/post' } });
  const live = chain([button]);
  const [nodes] = $hydrate.adopt(live, template, [{ path: [0], on: 'click', handler: () => () => {} }], false, []);
  assert.equal(nodes[0], button);
  assert.equal(button.getAttribute('formaction'), null);
  assert.equal(button.getAttribute('type'), 'button');
});

function comment(data = '') {
  return { nodeType: 8, data, nextSibling: null, firstChild: null };
}

test('text the server put after an anchor, and text inside a region, still matches the template', () => {
  const mood = el('i', { text: 'glad' });
  const live = chain([text('Hello '), el('b', { text: 'there' }), pi(''), text(', Ada! '), mood, text(' to see you.')]);
  const template = chain([text('Hello '), el('b', { text: 'there' }), comment(), el('i'), text(' to see you.')]);
  const [nodes] = $hydrate.adopt(live, template, [{ path: [2], text: () => 'glad' }], false, []);
  assert.equal(nodes[0], mood);
  const rows = chain([text('\n'), pi('['), text('\n    '), el('li', { text: '#2 LINUS' }), pi(']'), text('\n')]);
  const skeleton = chain([text('\n'), pi('['), pi(']'), text('\n')]);
  assert.ok(Array.isArray($hydrate.adopt(rows, skeleton, [], false, [])[0]));
});
