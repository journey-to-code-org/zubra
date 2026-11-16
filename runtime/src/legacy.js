// What older modules call: $define (interfaces 2 and 3) and $element (interface 4), which fill in
// what interface 5 parts and definitions name themselves (each part's binder, the slot router,
// form controls, hydration). It names every binder, so an app whose components are all interface 5
// doesn't load this.

import { bindAwait } from './await.js';
import { bindEach } from './each.js';
import { READS, defineElement, isSafeSrcset, isSafeUrl, refuse, useLegacy } from './element.js';
import { $classes, $global, $style, $toggle } from './parts.js';
import { $shadow } from './shadow.js';
import { $slotted, bindSlot } from './slots.js';
import { bindWhen } from './when.js';
import { $modified } from './modifiers.js';
import { $form } from './form.js';
import { $hydrate } from './hydrate.js';


/**
 * An older part's binder, from its keys, and its URL check (interface 4 and earlier wrote
 * `url: true`, `srcset: true`).
 */
function legacyBinder(part) {
  part.binder = part.when ? bindWhen : part.await ? bindAwait : part.each ? bindEach : part.slot ? bindSlot
    : part.modifiers ? $modified : part.global ? $global : part.classes ? $classes : part.toggle ? $toggle
    : part.style ? $style : null;
  if (part.url === true) part.url = isSafeUrl;
  if (part.srcset === true) part.srcset = isSafeSrcset;
}

/** @internal Register a compiled component: what the compiler's JavaScript output calls. */
export function $define(tag, definition) {
  if (!READS.includes(definition?.abi)) refuse(tag, definition);
  useLegacy(legacyBinder);
  return defineElement(tag, { ...definition, slotting: definition.slotting ?? $slotted, forming: definition.forming ?? $form, hydrating: definition.hydrating ?? $hydrate, shadowing: definition.shadowing ?? $shadow });
}

/**
 * @internal What interface 4 output calls (5.17 to 5.19.0; imported as `$define`). Its parts name
 * the binders of blocks and slots, but not, as 5.17 and 5.18 wrote it, event modifiers', form
 * controls or hydration: those are filled in as for `$define`. (A part that names its binder keeps
 * it, and a definition's own `forming` or `hydrating` wins.)
 */
export const $element = $define;
