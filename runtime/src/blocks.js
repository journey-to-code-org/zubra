// What the runtime's blocks share (zb-if, zb-each, zb-await and slots): a region's markers, a
// block's nodes made or found in server markup, and taking them out again. Loaded with the
// first binder a page's components import.

import { PI, TEXT, bind, blueprint, childRange, locate, marker, matchingClose, see } from './element.js';

/**
 * Whether to bind a region's server markup: not when the server left it to the element. A region
 * the server is still streaming sits in a named range (`<?start name>`…`<?end>`): the element
 * renders it from now on, so it removes the name, and the browser's `<template for>` finds nothing.
 */
export function hydratable(open, hydrating) {
  if (!hydrating || marker(open) !== '[?') return hydrating;
  const named = (node, kind) => node && (node.nodeType === PI ? node.target === kind : marker(node)?.startsWith(`?${kind}`));
  const start = open.previousSibling;
  const end = matchingClose(open)?.nextSibling;
  if (named(start, 'start') && named(end, 'end')) { start.remove(); end.remove(); }
  return false;
}

const regionRange = (open, close) => ({ first: open.nextSibling, stop: close });

/**
 * A block's template, parsed once per context. Inside `<svg>` (or `<math>`), the markup is
 * parsed inside that element, so `<circle>` and friends get their namespace: parsed alone, they
 * would be unknown HTML elements.
 */
// The element a fragment's nodes will go into, for fragments assembled before they're placed.
export const fragmentParents = new WeakMap();

/** The element `node` is in, or will be in once its fragment is placed. */
export function parentOf(node) {
  const parent = node.parentNode;
  return parent?.nodeType === 11 ? fragmentParents.get(parent) ?? null : parent;
}

// For a blueprint with no custom elements: a copy owned by this document, made once, which rows
// clone. Its clones need no adopting when they're inserted, and nothing in it has to upgrade.
const imported = new WeakMap();

const upgrades = (content) =>
  [...content.querySelectorAll('*')].some((element) => element.localName.includes('-') || element.hasAttribute('is'));

/** A fresh copy of `block`'s template for `parent`, ready for its parts to be found and bound. */
export function freshCopy(block, parent) {
  const content = blueprint(block, parent);
  let copy = imported.get(content);
  if (copy === undefined) {
    // importNode: custom elements inside upgrade now, so their properties exist before parts
    // bind (a plain clone stays in the template's inert document).
    copy = upgrades(content) ? null : document.importNode(content, true);
    imported.set(content, copy);
  }
  return copy === null ? document.importNode(content, true) : copy.cloneNode(true);
}

export function clearBetween(open, close) {
  while (open.nextSibling && open.nextSibling !== close) open.nextSibling.remove();
}

/**
 * `animate`: the region's nodes leave (`motion`, @zubra/runtime/motion, which the compiled module
 * imports only when a component animates) instead of going at once. They stay where they are,
 * and the region starts after them, so what replaces them is rendered beside them.
 */
export function departBetween(open, close, motion) {
  const nodes = [];
  for (let node = open.nextSibling; node && node !== close; node = node.nextSibling) nodes.push(node);
  if (!nodes.length) return;
  nodes[nodes.length - 1].after(open);
  motion.leave(nodes);
}

/** Remove everything between `open` and `close` in one operation. */
const nativeTextContent = typeof Node !== 'undefined' ? Object.getOwnPropertyDescriptor(Node.prototype, 'textContent').set : undefined;

export function deleteBetween(open, close) {
  if (open.nextSibling === close) return;
  // The region is everything its parent holds but blank text (a list's own <tbody> or <ul>):
  // emptying the parent and putting the markers and that text back is several times cheaper than
  // deleting a range's contents.
  const parent = open.parentNode;
  const before = [];
  const after = [];
  const blank = (node) => node.nodeType === TEXT && node.data.trim() === '';
  let edge = open.previousSibling;
  while (edge && blank(edge) && before.length < 4) { before.unshift(edge); edge = edge.previousSibling; }
  if (parent && !edge) {
    edge = close.nextSibling;
    while (edge && blank(edge) && after.length < 4) { after.push(edge); edge = edge.nextSibling; }
    if (!edge) {
      nativeTextContent.call(parent, '');
      for (const node of [...before, open, close, ...after]) Node.prototype.insertBefore.call(parent, node, null);
      return;
    }
  }
  const range = document.createRange();
  range.setStartAfter(open);
  range.setEndBefore(close);
  range.deleteContents();
}

/**
 * Render `block` between `open` and `close`. When `hydrating`, first try to bind to nodes the
 * server already put there; otherwise (or if they don't fit) clone the block's template.
 */
export function mountBlock(block, args, open, close, hydrating, context) {
  const parts = block.parts(...args);
  const nodes = hydrating ? locate(regionRange(open, close), parts, true) : null;
  if (nodes) {
    parts.forEach((part, index) => bind(part, nodes[index], true, context));
    return;
  }
  // @dev
  if (hydrating) console.warn(`zubra: server markup for a region does not match its template; rendering it fresh${see('server-rendering-and-hydration')}`);
  // @dev-end
  clearBetween(open, close);
  // Find and bind the parts in the fragment, then insert it: child components inside see
  // their props from the start, and can't move slotted nodes before they're found.
  const parent = parentOf(close);
  const fragment = freshCopy(block, parent);
  fragmentParents.set(fragment, parent);
  const fresh = locate(childRange(fragment), parts);
  parts.forEach((part, index) => bind(part, fresh[index], false, context));
  close.before(fragment);
}

// The native methods: a light-DOM host routes its own insertBefore to its slots (for content a
// framework adds), and a row of its own list isn't such content.
const nativeMoveBefore = typeof Element !== 'undefined' ? Element.prototype.moveBefore : undefined;

export function move(parent, node, before) {
  try {
    if (nativeMoveBefore && node.isConnected && parent.isConnected) return nativeMoveBefore.call(parent, node, before);
  } catch { /* not movable atomically (different document, …): insert instead */ }
  Node.prototype.insertBefore.call(parent, node, before);
}
