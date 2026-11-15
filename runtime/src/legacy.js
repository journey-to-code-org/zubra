// What interface 2 and 3 modules call: $define, which fills in what interface 4 parts and
// definitions name themselves (each part's binder, the slot router). It names every binder, so an
// app whose components are all interface 4 doesn't load this.

import { bindAwait } from './await.js';
import { bindEach } from './each.js';
import { ABI, READS, defineElement, useLegacy } from './element.js';
import { $slotted, bindSlot } from './slots.js';
import { bindWhen } from './when.js';


/** An interface 2 or 3 part's binder, from its keys. */
function legacyBinder(part) {
  part.binder = part.when ? bindWhen : part.await ? bindAwait : part.each ? bindEach : part.slot ? bindSlot : null;
}

/** @internal Register a compiled component: what the compiler's JavaScript output calls. */
export function $define(tag, definition) {
  if (!READS.includes(definition?.abi)) {
    throw new Error(`zubra: <${tag}> was compiled for a different @zubra/runtime (interface ${definition?.abi ?? 1}, this runtime is ${ABI}); recompile it with the matching zubra`);
  }
  useLegacy(legacyBinder);
  return defineElement(tag, definition.slotting ? definition : { ...definition, slotting: $slotted });
}
