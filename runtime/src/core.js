// @zubra/runtime's core: what every component and its script imports, with the binders most of
// them use (zb-if and zb-each), and without zb-await's (await.js), the slot router (slots.js) or
// $define for older modules (legacy.js). @zubra/server maps `@zubra/runtime` here and the binders to
// their own entries, so a page loads only those its components use.
export { Signal, isNative } from './signal.js';
export { effect, scope, flush, tick } from './effect.js';
export { resource } from './resource.js';
export {
  define, $element, ABI, state, computed, watch, onMount, onUnmount, id, props, host, emit, adoptStyles,
  createContext, provide, inject, ContextRequestEvent, ContextProviderEvent,
  formValue, validity, onFormReset, onFormRestore, onFormDisabled,
  prevent, stop, selfOnly, submit, keys, model, hasSlot, hydrated, signal, from, raw,
  isSafeUrl, isSafeSrcset, $r, $t,
} from './element.js';
// zb-if and zb-each are in most components (and the block helpers with them): in the core.
// zb-await, the slot router and $define, which fewer pages need, are files of their own.
export { $when } from './when.js';
export { $each } from './each.js';
