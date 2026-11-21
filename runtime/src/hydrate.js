// Taking over the server's markup (hydration): telling server markup from the page's own children
// by the template's shape, finding the parts in it, and putting back markers something stripped
// (remark.js, loaded only then). Compiled components import it (`hydrating: $hydrate`) unless
// their app never renders on a server (@zubra/unplugin's `hydrate: false`).
import { $r, blueprint, childRange, hasContent, isClose, isOpen, locate, marker, positions } from './element.js';
import { State, untrack } from './signal.js';

let remarker = null; // remark.js, once loaded
let remarking = null; // its import
const loadRemark = () => (remarking ??= import('./remark.js').then(
  (module) => (remarker = module),
  () => (remarker = { remark: () => false }),
));

const hasComment = (root) =>
  !!document.createTreeWalker(root, NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION).nextNode();

/** A range's shape: its top-level positions as tag names and region markers. */
const signature = (range) =>
  [...positions(range.first, range.stop)]
    .map((node) => (node.nodeType === 1 ? node.localName : isOpen(node) ? '[' : '#'))
    .join(' ');

/**
 * Whether `root`'s server markup lost the comments `template` has (its top-level elements are
 * there). A template that is only regions has none of its own: `roots`, from the compiler, names
 * the elements its regions' blocks start with, and markup with none of them is the page's own
 * content (text a framework gave it, say), which needs no check, so the element renders now.
 */
function lostComments(root, template, roots) {
  if (!root || !hasContent(root) || !hasComment(template) || hasComment(root)) return false;
  // The page's own children for a slot aren't server markup: the template's top-level elements
  // must be there, in order.
  const children = [...root.children];
  let at = 0;
  let elements = 0;
  for (const node of positions(template.firstChild, null)) {
    if (node.nodeType !== 1) continue;
    while (at < children.length && children[at].localName !== node.localName) at++;
    if (at++ >= children.length) return false;
    elements++;
  }
  return elements || !roots ? true : children.some((child) => roots.includes(child.localName));
}

const regionOpen = (mark) => mark === '[' || mark === '[!' || mark === '[?';

/**
 * Static text only. A `{expr}` the server filled in is the text node after an anchor (`<?zb ?>`
 * or `<!---->`), and a region's rows add their own text between its markers. Neither is in the
 * template, so neither can disagree with it.
 */
const staticText = (node) => {
  let text = '';
  let depth = 0;
  let previous = null;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const mark = child.nodeType === 1 ? null : marker(child);
    const skip = depth || child.nodeType !== 3 || mark === '';
    if (regionOpen(mark)) depth++;
    else if (mark === ']' && depth) depth--;
    else if (!skip && !(previous && marker(previous) === '')) text += child.data;
    previous = child;
  }
  return text;
};

const pathKey = (path) => (path ?? []).join(',');

/**
 * The live tree and the template agree at every element: the same markers and tags, the same
 * static text, and no attribute the template doesn't have unless a part binds it. A slot's
 * `<!--]-->` or `<?zb ]?>` changes its parent's shape, so the component renders fresh instead of
 * binding its listener to whatever element followed the early close. A lookalike child (the
 * template's button, with a visitor's text and `formaction`) is not adopted.
 */
function faithful(liveParent, templateParent, parts, path = []) {
  if (signature(childRange(liveParent)) !== signature(childRange(templateParent))) return false;
  const livePos = [...positions(liveParent.firstChild, null)];
  const templatePos = [...positions(templateParent.firstChild, null)];
  if (livePos.length !== templatePos.length) return false;
  for (let index = 0; index < livePos.length; index++) {
    const live = livePos[index];
    const template = templatePos[index];
    if (live.nodeType !== 1) continue;
    const here = path.concat(index);
    const key = pathKey(here);
    const writesText = parts.some((part) => part.text && pathKey(part.path) === key);
    if (!writesText && staticText(live) !== staticText(template)) return false;
    const kept = new Set([...template.attributes].map((attr) => attr.name));
    for (const attr of [...live.attributes]) {
      const bound = parts.some((part) => pathKey(part.path) === key && (
        (part.attribute && part.attribute.toLowerCase() === attr.name)
        || (attr.name === 'class' && (part.classes || part.toggle))
        || (attr.name === 'style' && part.style)
      ));
      if (bound) continue;
      if (!kept.has(attr.name)) live.removeAttribute(attr.name);
      else if (template.getAttribute(attr.name) !== attr.value) live.setAttribute(attr.name, template.getAttribute(attr.name));
    }
    if (!faithful(live, template, parts, here)) return false;
  }
  return true;
}

/** @internal What interface 4 output names as `hydrating`: taking over server markup. */
export const $hydrate = {
  /**
   * Before the first render: server markup that lost its comments waits for the code that puts
   * them back. The promise, or nothing to render now.
   */
  waits(root, template, roots, claimed) {
    return !remarker && claimed && lostComments(root, template, roots) ? loadRemark() : null;
  },
  /**
   * Server markup in `root`: its comments put back if they were stripped. `[nodes, lost]`: its
   * parts' nodes if it has the template's shape (null for the page's own children), and whether
   * its markers were missing and couldn't be put back.
   */
  adopt(root, template, parts, claimed, filled) {
    const stripped = claimed && hasComment(template) && !hasComment(root);
    const restored = stripped && !!remarker?.remark(root, template, parts, { blueprint, isOpen, isClose, read: $r, untrack, State, filled });
    const nodes = faithful(root, template, parts) ? locate(childRange(root), parts, true) : null;
    return [nodes, stripped && !restored];
  },
};
