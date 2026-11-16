// Where server markup stops having its template's shape, in words, for the development build's
// warning that an element was rendered fresh: the first difference in the top-level shape (what
// hydrate.js compares), or the first part whose place holds something else (what `locate`
// refused). Positions count elements and markers, as paths do. Loaded only when a mismatch
// happens, and only in development (it isn't in the production build), so a page that hydrates
// pays nothing for it. It imports nothing: element.js hands over its own helpers (`tools`), so a
// bundler has no code to share between this module and the runtime's entry.
let positions, walk, placed, isOpen, isClose, marker, matchingClose;
const childRange = (parent) => ({ first: parent.firstChild, stop: null });

const nameOf = (node) => (!node ? 'nothing' : node.nodeType === 1 ? `<${node.localName}>` : isOpen(node) ? 'a region (<?zb [?>…<?zb ]?>)' : isClose(node) ? "a region's end" : 'a text marker (<?zb ?>)');
const shapeOf = (range) => [...positions(range.first, range.stop)].map((node) => (node.nodeType === 1 ? `<${node.localName}>` : isOpen(node) ? '[region]' : '[text]')).join(' ') || 'nothing';
const expects = (part) => (part.when ? 'a zb-if region'
  : part.each ? 'a zb-each region'
  : part.await ? 'a zb-await region'
  : part.slot ? 'a slot region'
  : part.anchor || part.global ? 'a text marker (<?zb ?>)'
  : `an element${part.attribute ? ` (for its ${part.attribute} binding)` : part.text ? ' (for its text)' : ''}`);
/** Warn where `markup` (a fragment holding what the element had) and `template` part ways. */
export function report(tag, markup, template, parts, tools) {
  [positions, walk, placed, isOpen, isClose, marker, matchingClose] = tools;
  const where = mismatch(tag, childRange(markup), childRange(template), parts);
  if (where) console.warn(`zubra: where <${tag}>'s markup doesn't match its template: ${where} (positions count elements and markers)`);
}

function mismatch(tag, range, template, parts) {
  const want = shapeOf(template);
  const have = shapeOf(range);
  if (want !== have) return `the template's top level is ${want}, and the markup's is ${have}`;
  for (const part of parts) {
    const path = part.hydrate ? placed(range, part.hydrate) : part.path;
    const node = walk(range, path);
    const fits = !node ? false
      : part.when || part.each || part.slot || part.await ? isOpen(node) && matchingClose(node) !== null
      : part.anchor || part.global ? marker(node) === ''
      : node.nodeType === 1;
    if (fits) continue;
    if (!path.length) return `the template expects ${expects(part)} for content given to a child component, and the child's markup has no place for it`;
    // The elements the path goes through, as far as the markup has them.
    const through = [`<${tag}>`];
    for (let step = 1; step < path.length; step++) {
      const at = walk(range, path.slice(0, step));
      if (!at) break;
      through.push(at.nodeType === 1 ? `<${at.localName}>` : 'a region');
    }
    const reached = through.length === path.length;
    return `the template expects ${expects(part)} in ${through.join(' › ')}${reached ? `, at position ${path[path.length - 1] + 1}` : ''}, and the markup has ${reached ? nameOf(node) : `nothing at position ${path[through.length - 1] + 1} there`}${reached && node && isOpen(node) && matchingClose(node) === null ? ' that is never closed' : ''}`;
  }
  return '';
}
