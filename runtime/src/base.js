// @zubra/runtime's base: what every component's module names, with the binders most of them use
// (zb-if, zb-each, the simple parts, hydration) and the script API nearly every script calls
// (state, computed, effect, the lifecycle hooks, props, emit). It is the one file every page of
// @zubra/server loads (`zubra.js` in dist/bundled). What only some components use is in files of
// its own, which the server sends to the pages whose components name it: context (provide.js),
// form controls and their helpers (form.js), event modifiers and theirs (modifiers.js), shadow
// roots (shadow.js), resource() (resource.js), and, as before, zb-await (await.js), the slot
// router (slots.js) and older output's $define and $element (legacy.js).
//
// core.js is this and those first five: the whole script API, as it always was.
export { Signal, isNative } from './signal.js';
export { effect, scope, flush, tick } from './effect.js';
export {
  define, $component, ABI, state, computed, watch, onMount, onUnmount, id, props, host, emit,
  model, hasSlot, hydrated, signal, from, raw,
  isSafeUrl, isSafeSrcset, $r, $t,
  // The URL checks as interface 5 output names them (`url: $url`, `srcset: $srcset`).
  $url, $srcset,
} from './element.js';
export { $global, $classes, $toggle, $style } from './parts.js';
export { $when } from './when.js';
export { $each } from './each.js';
export { $hydrate } from './hydrate.js';
