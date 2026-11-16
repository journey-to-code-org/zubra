// Binders for the less common simple parts: a window or document listener, a computed class list,
// a class toggle and a style property. Interface 5 output names them (`binder: $classes`), so a
// component without one carries none of their code; legacy.js fills them in for older output.
import { $r, $srcset, $url, listen } from './element.js';
import { effect } from './effect.js';

/** @internal `<zb-window>`/`<zb-document>`: listening while this part of the template is rendered. */
export function $global(part) {
  const target = part.global === 'window' ? window : document;
  effect(() => {
    const listener = listen(part, target);
    target.addEventListener(part.on, listener);
    return () => target.removeEventListener(part.on, listener);
  });
}

/** @internal A computed class beside class: toggles: token by token, leaving the toggles' alone. */
export function $classes(part, node) {
  let previous = [];
  effect(() => {
    const next = String($r(part.classes()) ?? '').split(/\s+/).filter(Boolean);
    for (const token of previous) if (!next.includes(token)) node.classList.remove(token);
    for (const token of next) node.classList.add(token);
    previous = next;
  });
}

/** @internal `class:name={…}`. */
export function $toggle(part, node) {
  effect(() => {
    node.classList.toggle(part.toggle, !!$r(part.value()));
  });
}

/** @internal `style:property={…}`: one property at a time, through the CSSOM, so a value can't add declarations. */
export function $style(part, node) {
  effect(() => {
    const value = $r(part.value());
    if (value == null || value === false) node.style.removeProperty(part.style);
    else if (node.style.getPropertyValue(part.style) !== String(value)) node.style.setProperty(part.style, String(value));
  });
}

// A URL attribute's check (`url: $url`, `srcset: $srcset`), for output that imports by entry.
export { $url, $srcset };
