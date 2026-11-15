// A listener with modifiers: a part with `binder: $modified` (interface 4), for `onclick.prevent`,
// `onkeydown.shift.enter`, `.self`, `.once` and the rest, on an element or on `<zb-window>` /
// `<zb-document>`. A component whose listeners have none doesn't load this.
import { effect } from './effect.js';
import { $r, APPLE, formOf } from './element.js';

/**
 * The listener and its options: the handler, read when the event fires, behind the modifiers'
 * checks (`.self`, key filters) and effects (`.prevent`, `.stop`, `.submit`).
 */
function listen(part, node) {
  const m = part.modifiers ?? {};
  // `.mod` is ⌘ on Apple platforms and Ctrl elsewhere.
  const ctrl = m.ctrl || (m.mod && !APPLE());
  const meta = m.meta || (m.mod && APPLE());
  const listener = (event) => {
    if (m.self && event.target !== node) return;
    if (m.keys) {
      const key = event.key ?? '';
      if (!m.keys.some((wanted) => (wanted.length === 1 ? key.toLowerCase() === wanted : key === wanted))) return;
      // With a key, the named modifier keys must be held and the others not.
      if (!!m.shift !== event.shiftKey || !!ctrl !== event.ctrlKey || !!m.alt !== event.altKey || !!meta !== event.metaKey) return;
    } else if ((m.shift && !event.shiftKey) || (ctrl && !event.ctrlKey) || (m.alt && !event.altKey) || (meta && !event.metaKey)) {
      return;
    }
    if (m.prevent) event.preventDefault();
    if (m.stop) event.stopPropagation();
    const handler = $r(part.handler());
    if (typeof handler === 'function') handler.call(node, event);
    // `.submit`: the form the element belongs to (or, in a shadow root, the host's form).
    if (m.submit) formOf(node)?.requestSubmit();
  };
  const options = m.once || m.capture || m.passive ? { once: !!m.once, capture: !!m.capture, passive: !!m.passive } : undefined;
  return [listener, options];
}

function bindModified(part, node) {
  if (part.global) {
    // <zb-window>/<zb-document>: listening while this part of the template is rendered.
    const target = part.global === 'window' ? window : document;
    effect(() => {
      const [listener, options] = listen(part, target);
      target.addEventListener(part.on, listener, options);
      return () => target.removeEventListener(part.on, listener, options);
    });
  } else {
    const [listener, options] = listen(part, node);
    node.addEventListener(part.on, listener, options);
  }
}

/** @internal The binder an interface 4 part with modifiers names (`binder: $modified`). */
export { bindModified as $modified };
