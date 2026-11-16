// @zubra/runtime's core: what every component and its script imports, with the binders most of
// them use (zb-if and zb-each), and without zb-await's (await.js), the slot router (slots.js) or
// $define and $element for older modules (legacy.js). @zubra/server maps `@zubra/runtime` here and the binders to
// their own entries, so a page loads only those its components use.
export { Signal, isNative } from './signal.js';
export { effect, scope, flush, tick } from './effect.js';
export { resource } from './resource.js';
export {
  define, $component, ABI, state, computed, watch, onMount, onUnmount, id, props, host, emit,
  createContext, provide, inject, ContextRequestEvent, ContextProviderEvent,
  formValue, validity, onFormReset, onFormRestore, onFormDisabled,
  prevent, stop, selfOnly, submit, keys, model, hasSlot, hydrated, signal, from, raw,
  isSafeUrl, isSafeSrcset, $r, $t,
  // The URL checks as interface 5 output names them (`url: $url`, `srcset: $srcset`).
  $url, $srcset,
} from './element.js';
// The less common simple parts (window listeners, class lists and toggles, style properties) and
// the shadow-DOM path: named by the output that has them. In the core for @zubra/server's pages,
// and modules of their own, so a bundler leaves out what an app's components don't use.
export { $global, $classes, $toggle, $style } from './parts.js';
export { $shadow, adoptStyles } from './shadow.js';
// zb-if, zb-each, event modifiers and form controls are on most pages (and the block helpers
// with them): in the core, so a page loads them with it, not as more requests. zb-await, the slot
// router and $define, which fewer pages need, are files of their own. (Each is still a module of
// its own, so a bundler leaves out what an app's components don't import.)
export { $when } from './when.js';
export { $each } from './each.js';
export { $modified } from './modifiers.js';
export { $form } from './form.js';
// Taking over server markup: what compiled components import unless their app never renders on
// a server (@zubra/unplugin's `hydrate: false`).
export { $hydrate } from './hydrate.js';
