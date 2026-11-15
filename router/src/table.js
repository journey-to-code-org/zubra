// The route table: which component answers which path. Pure (no files, no compiler), so the
// rules are tested on their own and an edge entry can build the same table later.
//
// A page says where it lives with 'use route /farms/:id', or, in a `routes/` folder, with a
// bare 'use route' and its place in the folder (`routes/farms/[id].zb` is `/farms/:id`).
// Both make the same table. Matching is URLPattern's pathname syntax.

/** The folder `routes/` pages live in, relative to the components folder. */
export const ROUTES = 'routes';

/**
 * The path a component's place in `routes/` gives it, or null outside the folder:
 * `routes/index` → `/`, `routes/farms/[id]` → `/farms/:id`, `routes/docs/[...path]` → `/docs/:path*`.
 */
export function folderPattern(name) {
  const parts = name.split('/');
  if (parts[0] !== ROUTES || parts.length < 2) return null;
  const segments = parts.slice(1);
  if (segments.at(-1) === 'index') segments.pop();
  const pattern = segments.map((segment) => {
    const rest = /^\[\.\.\.([A-Za-z_$][\w$]*)\]$/.exec(segment);
    if (rest) return `:${rest[1]}*`;
    const param = /^\[([A-Za-z_$][\w$]*)\]$/.exec(segment);
    if (param) return `:${param[1]}`;
    if (/[[\]:*?(){}]/.test(segment)) throw new RouteError(`${name}: a folder or file name in ${ROUTES}/ is plain text or one [param] (\`[id]\`, \`[...path]\`), not \`${segment}\``);
    return segment;
  });
  return `/${pattern.join('/')}`;
}

/** The named parameters of a pathname pattern, in order (`:id`, `:path*`). */
export function patternParams(pattern) {
  return [...pattern.replace(/\\./g, '').matchAll(/:([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
}

export class RouteError extends Error {
  constructor(message) {
    super(`@zubra/router: ${message}`);
    this.name = 'RouteError';
  }
}

/**
 * The table from what each component's interface says.
 *
 * `entries`: `[{ name, file, props: ['id', …], route: { kind, pattern, params, root, load, reads } }]`
 * for every component that is a route or a layout (`file` is for messages).
 * Returns `{ pages: [{ name, pattern, params, load }], layouts: [...] }`, pages ordered so the
 * most specific pattern is tried first.
 */
export function buildTable(entries) {
  const pages = [];
  const layouts = [];
  for (const { name, file = name, props = [], route } of entries) {
    const fromFolder = route.kind === 'layout' ? null : folderPattern(name);
    let pattern = route.pattern;
    if (pattern == null) {
      if (route.kind === 'layout') {
        // Layouts by folder are A3's; until then a layout names its prefix.
        throw new RouteError(`${file} says 'use layout' with no prefix: name it, 'use layout /farm'`);
      }
      if (fromFolder == null) {
        throw new RouteError(`${file} says 'use route' with no path, and isn't in a ${ROUTES}/ folder: name its path ('use route /farms/:id'), or move it to ${ROUTES}/`);
      }
      pattern = fromFolder;
      // The compiler checked a written path's parameters; a folder's are checked here.
      for (const param of patternParams(pattern)) {
        const read = props.includes(param) || (route.load && (route.reads == null || route.reads.includes(param)));
        if (!read) throw new RouteError(`${file} is ${pattern}, whose parameter \`${param}\` neither \`load\` nor a prop reads`);
      }
    } else if (fromFolder != null && fromFolder !== pattern) {
      throw new RouteError(`${file} says 'use route ${pattern}', but its place in ${ROUTES}/ makes it ${fromFolder}: drop the path from the directive, or move the file`);
    }
    const entry = { name, file, pattern, params: patternParams(pattern), load: Boolean(route.load), root: Boolean(route.root) };
    (route.kind === 'layout' ? layouts : pages).push(entry);
  }
  for (const list of [pages, layouts]) {
    const seen = new Map();
    for (const entry of list) {
      const other = seen.get(entry.pattern);
      if (other) throw new RouteError(`${other.file} and ${entry.file} are both ${list === pages ? 'routes' : 'layouts'} for ${entry.pattern}`);
      seen.set(entry.pattern, entry);
    }
  }
  pages.sort((a, b) => compareSpecificity(a.pattern, b.pattern));
  return { pages, layouts };
}

// Static segments before parameters before wildcards, segment by segment; then longer first.
const rank = (segment) => (segment.includes('*') ? 2 : segment.includes(':') ? 1 : 0);
function compareSpecificity(a, b) {
  const left = a.split('/');
  const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = rank(left[i]) - rank(right[i]);
    if (difference) return difference;
  }
  return right.length - left.length || (a < b ? -1 : a > b ? 1 : 0);
}

/** A matcher over the pages: `match(pathname)` → `{ page, params }` or null. */
export function matcher(pages, URLPatternClass) {
  const compiled = pages.map((page) => ({ page, pattern: new URLPatternClass({ pathname: page.pattern }) }));
  return (pathname) => {
    for (const { page, pattern } of compiled) {
      const found = pattern.exec({ pathname });
      if (found) {
        const params = {};
        for (const [key, value] of Object.entries(found.pathname.groups)) if (value !== undefined) params[key] = value;
        return { page, params };
      }
    }
    return null;
  };
}
