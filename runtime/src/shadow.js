// A shadow-DOM component's own path: its shadow root, the sheets adopted into it (its own and the
// app-wide ones from adoptStyles()), and following which slots its children fill. Interface 5
// output for a shadow component names it (`shadowing: $shadow`), so light-DOM apps carry none of it;
// legacy.js fills it in for older output.
import { adopt, isContent, toSheet } from './element.js';

const globalSheets = [];
const shadowRoots = new Set(); // WeakRef<ShadowRoot>
// Refs to collected roots are dropped once the set doubles, so a page that makes and removes
// shadow components without ever calling adoptStyles() doesn't keep one per element it made.
let pruneAt = 256;

/**
 * Add stylesheets (CSS text or `CSSStyleSheet`s) to every zubra shadow root, now and later — for
 * app-wide CSS such as Tailwind's output, which page styles can't carry into shadow DOM.
 * Light-DOM components already get page CSS. Returns the sheets.
 */
export function adoptStyles(...styles) {
  const sheets = styles.map(toSheet);
  globalSheets.push(...sheets);
  for (const ref of [...shadowRoots]) {
    const root = ref.deref();
    if (root) adopt(root, sheets);
    else shadowRoots.delete(ref);
  }
  return sheets;
}

/** @internal What interface 5 output names as `shadowing`. */
export const $shadow = {
  /** The host's shadow root (the server's, if it rendered one), with its sheets adopted. */
  attach(host, sheets) {
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    adopt(root, [...globalSheets, ...sheets]);
    shadowRoots.add(new WeakRef(root));
    if (shadowRoots.size >= pruneAt) {
      for (const ref of shadowRoots) if (!ref.deref()) shadowRoots.delete(ref);
      pruneAt = Math.max(256, shadowRoots.size * 2);
    }
    // The server's copy of the styles, for before this ran; the adopted sheet replaces it.
    const serverStyles = root.firstElementChild;
    if (serverStyles?.localName === 'style' && serverStyles.hasAttribute('data-zubra')) serverStyles.remove();
    return root;
  },
  /** The host's children are assigned by the browser: keep the `filled` signals in step with them. */
  follow(host, hooks) {
    const follow = () => {
      for (const [name, signal] of hooks.filled) {
        signal.set([...host.childNodes].some((node) => isContent(node) && (node.nodeType === 1 ? (node.getAttribute('slot') ?? 'default') : 'default') === name));
      }
    };
    follow();
    hooks.mount.push(() => {
      follow();
      const observer = new MutationObserver(follow);
      observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['slot'], characterData: true });
      return () => observer.disconnect();
    });
  },
};
