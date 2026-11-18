// zb-each: a part with `binder: $each` (interface 4).

import { clearBetween, deleteBetween, freshParts, hydratable, mountBlock, move, parentOf } from './blocks.js';
import { scope, effect, batch } from './effect.js';
import { $r, bind, isOpen, matchingClose, positions, see } from './element.js';
import { trackItems } from './deep.js';
import { State, untrack } from './signal.js';

/**
 * zb-each: one row per item. Each row holds its item and index as signals, so changing one
 * item updates only that row's parts.
 *
 * - Without a key, rows are matched by position: a new array updates rows in place, and rows are
 *   only created or removed at the end.
 * - With `key={…}`, rows follow their key: reordering moves the existing rows (with whatever DOM
 *   state they have, like a half-typed input), using `moveBefore()` where the browser has it so
 *   focus and iframes survive the move.
 */
export function bindEach(part, open, hydrating, context) {
  hydrating = hydratable(open, hydrating);
  const close = matchingClose(open);
  // Rows belong to this scope, not to the effect below, so re-running the effect (the list
  // changed) doesn't dispose them.
  const rowsOwner = scope();
  let rows = [];

  // A row is the nodes from `open` to `close`. Rows the server rendered keep the markers it put
  // around them. A row made here is its block's own nodes, from first to last, with no markers:
  // what a block's nodes are at the top never changes after it's bound (a region inside one keeps
  // its own markers), so the first and last stay the row's ends. Only an empty block needs one.
  const createRow = (value, index, key, rowOpen, rowClose, hydrateRow) => {
    const item = new State(value);
    const position = new State(index);
    if (rowOpen) {
      const owner = rowsOwner.run(() => scope(() => mountBlock(part.block, [item, position], rowOpen, rowClose, hydrateRow, context)));
      return { key, item, position, open: rowOpen, close: rowClose, owner };
    }
    let top;
    const owner = rowsOwner.run(() => scope(() => {
      const parts = part.block.parts(item, position);
      let nodes;
      [top, nodes] = freshParts(part.block, parentOf(open), parts);
      parts.forEach((each, at) => bind(each, nodes[at], false, context));
    }));
    // One element: the row is that element.
    const lone = top.nodeType === 1;
    if (!lone && !top.firstChild) top.append(document.createComment(''));
    return { key, item, position, open: lone ? top : top.firstChild, close: lone ? top : top.lastChild, owner };
  };
  const nodesOf = (row) => {
    if (row.open === row.close) return [row.open];
    const nodes = [];
    for (let node = row.open; ; node = node.nextSibling) {
      nodes.push(node);
      if (node === row.close) return nodes;
    }
  };
  const removeRow = (row) => {
    row.owner.dispose();
    if (part.animate) part.animate.leave(nodesOf(row), { float: true });
    else for (const node of nodesOf(row)) node.remove();
  };
  const elementsOf = (row) => nodesOf(row).filter((node) => node.nodeType === 1);
  const placeRow = (row, before) => {
    const parent = close.parentNode;
    for (const node of nodesOf(row)) move(parent, node, before);
  };
  const keysOf = (list) => {
    const seen = new Set();
    return list.map((value, index) => {
      let key = part.key(value, index);
      if (seen.has(key)) {
        // @dev
        console.error('zubra: duplicate zb-each key', key, `(row ${index + 1}); that row is not keyed${see('directives')}`);
        // @dev-end
        key = Symbol('duplicate');
      }
      seen.add(key);
      return key;
    });
  };

  let first = hydrating;
  effect(() => {
    let list = $r(part.each());
    if (!Array.isArray(list)) {
      // @dev
      if (list != null) console.error('zubra: zb-each items must be an array; got', list);
      // @dev-end
      list = [];
    }
    // Reactive state (deep.js) tracks by property: watching the list's items here means
    // `items.push(x)`, `items.splice(…)` and `items[i] = x` re-run this effect.
    trackItems(list);
    const hydrate = first;
    first = false;
    untrack(() => {
      const keys = part.key ? keysOf(list) : null;
      if (hydrate) {
        const existing = [...positions(open.nextSibling, close)];
        if (existing.length === list.length && existing.every(isOpen)) {
          rows = existing.map((rowOpen, index) =>
            createRow(list[index], index, keys?.[index], rowOpen, matchingClose(rowOpen), true));
          return;
        }
        // @dev
        console.warn(`zubra: server markup for a list does not match its items; rendering it fresh${see('server-rendering-and-hydration')}`);
        // @dev-end
        clearBetween(open, close);
      }

      if (!keys) {
        const shared = Math.min(rows.length, list.length);
        for (let index = 0; index < shared; index++) {
          rows[index].item.set(list[index]);
          rows[index].position.set(index);
        }
        if (rows.length < list.length) {
          const fragment = new DocumentFragment();
          for (let index = rows.length; index < list.length; index++) {
            const row = createRow(list[index], index);
            fragment.append(...nodesOf(row));
            rows.push(row);
          }
          close.before(fragment);
        }
        if (!list.length && rows.length) {
          batch(() => { for (const row of rows) row.owner.dispose(); });
          deleteBetween(open, close);
          rows = [];
        }
        batch(() => { for (const row of rows.splice(list.length)) removeRow(row); });
        return;
      }

      // Keyed: reuse the row for each key, create the missing ones, drop the rest, then walk the
      // new order and move only rows that aren't already where they belong.
      const byKey = new Map(rows.map((row) => [row.key, row]));
      // Nothing reused (cleared, or replaced wholesale): drop every row at once, then build the
      // new ones in one fragment and insert it once.
      if (!part.animate && rows.length && !keys.some((key) => byKey.has(key))) {
        batch(() => { for (const row of rows) row.owner.dispose(); });
        deleteBetween(open, close);
        rows = [];
        byKey.clear();
      }
      if (!rows.length) {
        const fragment = new DocumentFragment();
        rows = list.map((value, index) => {
          const row = createRow(value, index, keys[index]);
          fragment.append(...nodesOf(row));
          return row;
        });
        close.before(fragment);
        return;
      }
      // `animate`: the rows that stay glide from where they were (@zubra/runtime/motion).
      const reorder = () => {
        const was = new Map(rows.map((row, index) => [row, index]));
        const next = list.map((value, index) => {
          const row = byKey.get(keys[index]);
          if (!row) return createRow(value, index, keys[index]);
          byKey.delete(keys[index]);
          row.item.set(value);
          row.position.set(index);
          return row;
        });
        batch(() => { for (const row of byKey.values()) removeRow(row); });
        // The longest run of rows still in their old order stays put; every other row (and every
        // new one) goes before the row after it, from the end. A swap moves two rows, not the
        // rows between them.
        const stay = inOrder(next.map((row) => was.get(row) ?? -1));
        let before = close;
        for (let index = next.length - 1; index >= 0; index--) {
          if (!stay.has(index)) placeRow(next[index], before);
          before = next[index].open;
        }
        rows = next;
      };
      if (part.animate) part.animate.glide(rows.flatMap(elementsOf), reorder);
      else reorder();
    });
  });
}

/**
 * The indexes of a longest strictly increasing run in `sequence` (negative entries never count):
 * for a keyed list, which rows are already in order and needn't move. O(n log n).
 */
function inOrder(sequence) {
  const tails = []; // tails[length - 1]: the index ending the best run of that length so far
  const previous = new Array(sequence.length);
  for (let index = 0; index < sequence.length; index++) {
    const value = sequence[index];
    if (value < 0) continue;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]] < value) low = middle + 1;
      else high = middle;
    }
    previous[index] = low > 0 ? tails[low - 1] : -1;
    tails[low] = index;
  }
  const kept = new Set();
  for (let index = tails.length ? tails[tails.length - 1] : -1; index >= 0; index = previous[index]) kept.add(index);
  return kept;
}

/** @internal The binder an interface 4 part names (`binder: $each`). */
export { bindEach as $each };
