// zb-if and zb-switch: a part with `binder: $when` (interface 4).

import { clearBetween, departBetween, hydratable, mountBlock } from './blocks.js';
import { effect } from './effect.js';
import { $r, matchingClose, untrack } from './element.js';
import { Signal } from './signal.js';

/** zb-if: re-render only when the chosen branch changes, not whenever the test re-runs. */
export function bindWhen(part, open, hydrating, context) {
  hydrating = hydratable(open, hydrating);
  const close = matchingClose(open);
  const branch = new Signal.Computed(() => ($r(part.when()) ? 0 : 1));
  let first = hydrating;
  effect(() => {
    const block = part.blocks[branch.get()];
    const hydrate = first;
    first = false;
    // Effects created while mounting belong to this effect, so switching branches disposes them.
    untrack(() => {
      if (part.animate && !hydrate) departBetween(open, close, part.animate);
      if (block) mountBlock(block, [], open, close, hydrate, context);
      else clearBetween(open, close);
    });
  });
}

/** @internal The binder an interface 4 part names (`binder: $when`). */
export { bindWhen as $when };
