// @zubra/router: serve components that say 'use route <path>' as pages.
//
//   import { createZubra } from '@zubra/server';
//   import { createRouter } from '@zubra/router';
//   const zubra = createZubra({ components: 'components' });
//   const router = await createRouter({ zubra, components: 'components' });
//
//   router.handle(req, res)   // Node's http: true if it answered (a GET or HEAD to a route)
//   router.fetch(request)     // fetch-style servers: a Response, or null if not ours
//   router.listener           // (req, res) for http.createServer: a route, or 404
//
// It is one more handler in the app's own server, like `zubra.handle` and `actions.handle`:
// the app keeps its order, its static files and its other routes (plan/app-design.md).
//
// A route's `load({ params, url, request })` runs on the server before the page renders; what
// it returns becomes the page's props. A parameter the page declares as a prop is passed too.
//
// Layouts wrap the page, outermost first: `app.zb`, then each 'use layout <prefix>' the path is
// under, the page in the innermost one's default slot. A layout has its own `load`, and one
// that declares a `route` prop is given `{ path, pattern, params }` (to mark where you are).
//
// `load` is given `{ params, url, request, route, context, result }`: `context` is the app's
// (`createRouter({ context })`, the same function `createActions` takes), `result` an action's
// answer after a post without JavaScript (`createRouter({ actions })`). Besides props it can
// return a `title`, `notFound()`, `redirect(to)` or `show(component, props)`.
import { randomUUID } from 'node:crypto';
import { SourceMap } from 'node:module';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCompiler } from '@zubra/server';
import { ANSWER } from './answers.js';
import { APP, buildTable, fromRoot, layoutMatcher, matcher, RouteError } from './table.js';

export { notFound, redirect, show } from './answers.js';

export { RouteError };

const SOURCE = /\.zb(?:\.[jt]sx)?$/;

/** The component shown in the shell's slot for a 404 or a 500, when the app has one. */
const ERROR = 'error';

let compiler;
async function compilerModule() {
  if (!compiler) {
    findCompiler();
    compiler = await import('@zubra/compiler');
  }
  return compiler;
}

async function urlPattern() {
  if (globalThis.URLPattern) return globalThis.URLPattern;
  return (await import('urlpattern-polyfill/urlpattern')).URLPattern;
}

/**
 * `zubra`: the app's `createZubra()`, which renders the pages. `components`: the same folder
 * (default `components`). `cacheDir`: where the routes' server halves are written (bare imports
 * resolve from there, so keep it inside the project). `onError(error, request, about)`: called when a
 * `load` throws or a page fails to render; the browser gets a 500, never the message. `about` is
 * `{ route, component, file, line }`: the route answered, and the component whose `load` threw
 * with its file and the line of that file it threw at (all null when it was the render; `line`
 * also when the error has no stack to read it from). By default it is logged, with the request and the file. `lang`: the document's
 * language (default `en`). `head`: HTML for every page's `<head>` (fonts, a stylesheet), or a
 * function of `{ url, request, route }` returning it; written as given, so it is the app's own
 * markup, never a visitor's text. `context({ request, req })`: what each `load` gets as
 * `context` (the signed-in person, a database handle), made once per request; give it the
 * function `createActions` has. `actions`: the app's `createActions()`, so `load` gets an
 * action's answer as `result`.
 */
export async function createRouter({
  zubra,
  components = 'components',
  cacheDir = join(process.cwd(), 'node_modules', '.cache', 'zubra-router'),
  onError = (error, request, about) => {
    // Which request and which file, before the error: its own stack names only the generated
    // server half in the cache (`boom-page.route.mjs`), not the component it was written in
    // (unless Node runs with `--enable-source-maps`, which reads the half's map).
    console.error(`@zubra/router: ${request.method} ${about.route.path}: ${about.file ? `the load in ${about.file} threw${about.line ? `, at line ${about.line}` : ''}` : 'the page failed to render'} (the browser got a 500 without the message):`);
    console.error(error);
  },
  lang = 'en',
  head = '',
  context,
  actions,
} = {}) {
  if (!zubra?.page) throw new RouteError('createRouter({ zubra }) needs the app\'s createZubra() to render pages');
  const root = resolve(components);
  if (!existsSync(root)) throw new RouteError(`no components folder at ${root}`);
  const { request: compile, sources: read } = await compilerModule();
  mkdirSync(cacheDir, { recursive: true });

  // Every component that is a route or a layout: what its interface says, and its server half.
  const entries = [];
  const halves = new Map();
  for (const path of sourcesUnder(root)) {
    const described = compile({ emit: 'interface', path, files: read(path) });
    if (!described.ok) throw new Error(described.error);
    const info = JSON.parse(described.output);
    const name = relative(root, path).split(sep).join('/').replace(SOURCE, '');
    if (!info.route && name !== APP) continue;
    const file = relative(process.cwd(), path);
    entries.push({ name, file, props: info.props.map((prop) => prop.name), slots: info.slots, route: info.route });
    if (info.route?.load) halves.set(name, path);
  }
  const { pages, layouts } = buildTable(entries);
  const fileOf = new Map(entries.map((entry) => [entry.name, entry.file]));
  // The props a component declares: only those are taken from what the loads return.
  const declaredBy = new Map(entries.map((entry) => [entry.name, new Set(entry.props)]));
  const propsOf = (name) => {
    if (!declaredBy.has(name)) declaredBy.set(name, new Set(zubra.describe(name).props.map((prop) => prop.name)));
    return declaredBy.get(name);
  };
  const isRoot = new Map(layouts.map((layout) => [layout.name, layout.root]));
  // Errors render inside the shell, with `error.zb` in its slot when the app has one.
  const hasShell = layouts.some((layout) => layout.name === APP);
  const hasErrorPage = zubra.names.includes(ERROR);

  // The server halves of those with a `load`, written to the cache and imported. Their relative
  // imports point back at the source; each is written beside its place and renamed in, so a
  // second process starting at the same moment never imports half a file.
  const loads = new Map();
  const linesOf = new Map();
  const MAP = /\n\/\/# sourceMappingURL=data:application\/json;base64,([A-Za-z0-9+/=]+)\s*$/;
  /** The line of the component's own file where `error` was thrown in its `load`, or null. */
  const lineIn = (name, error) => {
    const lines = linesOf.get(name);
    if (!lines || typeof error?.stack !== 'string') return null;
    // The first frame in the half itself (a function it called may be the one that threw).
    const at = error.stack.indexOf(lines.href);
    const frame = at < 0 ? null : /^(?:\?[^:\s)]*)?:(\d+):(\d+)/.exec(error.stack.slice(at + lines.href.length));
    if (!frame) return null;
    const entry = lines.map.findEntry(Number(frame[1]) - 1, Number(frame[2]) - 1);
    return typeof entry?.originalLine === 'number' ? entry.originalLine + 1 : null;
  };
  for (const [name, path] of halves) {
    // `sourceMap`: the half ends with a map of its functions' lines to the component's (a
    // compiler from before it knew the word answers without one, and lines stay the half's).
    const response = compile({ emit: 'server', path, files: read(path), sourceMap: true });
    if (!response.ok) throw new Error(response.error);
    // One file name per component name, with no two names sharing one (`a/b` and `a__b` did).
    const module = join(cacheDir, `${name.replace(/_/g, '_u').replace(/\//g, '_s')}.route.mjs`);
    const writing = `${module}.${process.pid}.${randomUUID()}.tmp`;
    let code = rewriteImports(response.output, (specifier) => pathToFileURL(resolve(dirname(path), specifier)).href);
    const mapped = MAP.exec(code);
    if (mapped) {
      // The map names the component by its address, so Node's own `--enable-source-maps` reads
      // it too; and it is kept, to say the line when a `load` throws without that flag.
      const map = { ...JSON.parse(Buffer.from(mapped[1], 'base64').toString()), sources: [pathToFileURL(path).href] };
      code = `${code.slice(0, mapped.index)}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`;
      linesOf.set(name, { href: pathToFileURL(module).href, map: new SourceMap(map) });
    }
    writeFileSync(writing, code);
    renameSync(writing, module);
    loads.set(name, (await import(`${pathToFileURL(module).href}?t=${Date.now()}`)).load);
  }

  const URLPatternClass = await urlPattern();
  const match = matcher(pages, URLPatternClass);
  const layoutsOver = layoutMatcher(layouts, URLPatternClass);

  /** A Response for a GET or HEAD to a route, or null. `extra` (`{ req }`, `{ c }`) goes to `context`. */
  async function respond(request, extra = {}, { unknown = false } = {}) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    const found = unknown ? null : match(url.pathname);
    if (!found && !unknown) return null;
    const { page = null, params: pageParams = {} } = found ?? {};
    // The layouts over this path, matched against the path itself (`layoutMatcher`), and their
    // parameters, so a layout's `load` reads its own (`params.org`) whatever the page calls it.
    const over = page ? layoutsOver(url.pathname) : [];
    const params = Object.assign({}, ...over.map((each) => each.params), pageParams);
    const route = { path: url.pathname, pattern: page?.pattern ?? null, params };
    const headers = new Headers();
    // `about`: what was being answered (`route`), and, when a `load` threw, whose it was
    // (`component`, and its `file` from where the server runs); both null for a render.
    let thrower = null;
    const about = (error) => ({ route, component: thrower, file: thrower === null ? null : fileOf.get(thrower) ?? null, line: thrower === null ? null : lineIn(thrower, error) });
    const fail = (error) => {
      onError(error, request, about(error));
      return errorPage(500);
    };
    const document = async (body, title) => {
      const extraHead = typeof head === 'function' ? await head({ url, request, route }) : head;
      const titled = title == null ? '' : `<title>${escapeText(title)}</title>`;
      return `<!doctype html>\n<html lang="${escapeAttribute(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${titled}${extraHead ?? ''}</head><body>${body}</body></html>`;
    };

    // A 404 or a 500, inside the app's shell where there is one: `error.zb` in the shell's slot
    // (or a heading), and `{ status }` as the shell's `error` prop if it declares one. Never
    // the error's message. Plain text when there is no shell, or the shell itself can't render.
    const errorPage = async (status) => {
      const plain = () => text(status, status === 404 ? 'Not found' : 'Internal error', headers);
      if (!hasShell || threw.has(APP)) return plain();
      try {
        const answer = loads.has(APP) ? await run(APP) : {};
        if (answer[ANSWER]) return plain();
        const error = { status };
        const give = (name, data) => {
          const declared = propsOf(name);
          const props = {};
          if (declared.has('route')) props.route = route;
          for (const [key, value] of Object.entries(data)) if (declared.has(key)) props[key] = value;
          if (declared.has('error')) props.error = error;
          return props;
        };
        const rendering = zubra.page();
        const words = status === 404 ? 'Page not found' : 'Something went wrong';
        const inside = hasErrorPage ? rendering.render(ERROR, give(ERROR, { status })) : `<h1>${words}</h1>`;
        const html = rendering.finish(await document(rendering.render(APP, give(APP, answer), { default: inside }), words));
        headers.set('content-type', 'text/html; charset=utf-8');
        return new Response(request.method === 'HEAD' ? null : html, { status, headers });
      } catch (failure) {
        onError(failure, request, about(failure));
        return plain();
      }
    };

    // What every `load` of this request is given. The app's context is made once, and so is the
    // read of an action's answer (reading it clears its cookie), and only if a `load` runs.
    let given;
    const loadArguments = async () => {
      if (!given) {
        // A HEAD (a prefetch, a link checker) doesn't use up an action's one-use answer: the
        // GET that follows still shows it.
        const result = actions && request.method !== 'HEAD' ? actions.result(extra.req ?? request, (name, value) => headers.append(name, value)) : null;
        given = { params, url, request, route, context: (context ? await context({ request, ...extra }) : null) ?? {}, result };
      }
      return given;
    };
    const loaded = new Map();
    const threw = new Set();
    const run = async (name) => {
      if (!loaded.has(name)) {
        try {
          loaded.set(name, (await loads.get(name)(await loadArguments())) ?? {});
        } catch (error) {
          threw.add(name);
          thrower = name;
          throw error;
        }
      }
      return loaded.get(name);
    };
    if (!page) return errorPage(404);

    // The layouts, outermost first, then the page. Each `load` runs in that order, and what the
    // ones outside returned reaches the ones inside as props they declare. A `show()` puts
    // another component in the place of the one that answered, and the walk starts again with
    // it (the loads that already ran aren't run twice).
    //
    // Every layout over the path runs its `load`, a `root` layout's outer ones and `app.zb`'s
    // included, so an outer check guards a root section too; only those from the innermost
    // `root` one are rendered.
    const around = over.map(({ layout }) => layout.name);
    let rendered = new Set(fromRoot(over.map(({ layout }) => layout)).map((layout) => layout.name));
    let chain = around;
    let leaf = { name: page.name };
    let status = 200;
    let parts;
    let title;
    try {
      walk: for (let walks = 0; ; walks++) {
        // Each show() from a layout leaves fewer layouts, so this can't go round for long.
        if (walks > around.length + 2) throw new RouteError(`${route.pattern}: show() kept being answered with another show()`);
        parts = [];
        title = undefined;
        const data = {};
        const names = [...chain, leaf.name];
        for (let index = 0; index < names.length; index++) {
          const name = names[index];
          const last = index === names.length - 1;
          const answer = last && leaf.props ? leaf.props : loads.has(name) ? await run(name) : {};
          switch (answer[ANSWER]) {
            case 'notFound':
              return errorPage(404);
            case 'redirect':
              headers.set('location', checkedLocation(answer, url));
              return new Response(null, { status: answer.status, headers });
            case 'show':
              // In place of a layout: inside the layouts over it, as if it weren't there (so a
              // `root` layout that turns someone away shows its notice in the app's shell).
              if (!last) {
                chain = around.slice(0, around.indexOf(name));
                rendered = new Set(fromRoot(chain.map((each) => ({ name: each, root: isRoot.get(each) }))).map((each) => each.name));
              }
              leaf = { name: answer.name, props: { ...answer.props } };
              status = answer.status;
              continue walk;
          }
          Object.assign(data, answer);
          if (answer.title != null) title = String(answer.title);
          const declared = propsOf(name);
          const props = {};
          if (declared.has('route')) props.route = route;
          for (const [key, value] of Object.entries(params)) if (declared.has(key)) props[key] = value;
          // Props the component declares; anything else the loads return doesn't reach it.
          for (const [key, value] of Object.entries(data)) if (declared.has(key)) props[key] = value;
          if (last || rendered.has(name)) parts.push({ name, props, last });
        }
        break;
      }
    } catch (error) {
      return fail(error);
    }

    let html;
    try {
      const rendering = zubra.page();
      // Inside out: the page, then each layout with what's inside it in its default slot.
      let body = '';
      for (const { name, props, last } of parts.reverse()) {
        body = last ? rendering.render(name, props) : rendering.render(name, props, { default: body });
      }
      html = rendering.finish(await document(body, title));
    } catch (error) {
      return fail(error);
    }
    headers.set('content-type', 'text/html; charset=utf-8');
    // A page whose loads read the request (the session, an action's answer) is that visitor's:
    // no shared cache keeps it for the next one. The app can say otherwise in its own handler.
    if (given) headers.set('cache-control', 'private, no-store');
    return new Response(request.method === 'HEAD' ? null : html, { status, headers });
  }

  /** Node's http: answers a route and returns true, or returns false. */
  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let request;
    try { request = toRequest(req); } catch { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return true; }
    const response = await respond(request, { req });
    if (!response) return false;
    await send(response, res);
    return true;
  }

  /**
   * The 404 page, for the end of the app's handlers: inside `app.zb` (with `error.zb` in its
   * slot, if there is one) for a GET or HEAD, plain text otherwise.
   */
  async function notFound(req, res) {
    let response = null;
    try { response = await respond(toRequest(req), { req }, { unknown: true }); } catch {}
    if (response) await send(response, res);
    else res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }

  /** For `http.createServer(router.listener)`: a route, or the 404 page. */
  async function listener(req, res) {
    if (!(await handle(req, res))) await notFound(req, res);
  }

  return {
    handle,
    listener,
    notFound,
    fetch: (request, extra) => respond(request, extra),
    /** Fetch-style servers: the 404 page as a Response (see `notFound`). */
    notFoundResponse: async (request, extra) => (await respond(request, extra, { unknown: true })) ?? text(404, 'Not found'),
    /** The pages, most specific first: `[{ name, pattern, params, load }]`. */
    routes: () => pages.map(({ name, pattern, params, load, layouts }) => ({ name, pattern, params, load, layouts })),
    /** The layouts, outermost first: `[{ name, pattern, root }]` (`app.zb` is `/`). */
    layouts: () => layouts.map(({ name, pattern, root }) => ({ name, pattern, root })),
    /** Which page a path goes to: `{ name, pattern, params }`, or null. */
    match: (pathname) => {
      const found = match(pathname);
      return found && { name: found.page.name, pattern: found.page.pattern, params: found.params };
    },
  };
}

const escapeAttribute = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const escapeText = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function text(status, body, headers = new Headers()) {
  headers.set('content-type', 'text/plain; charset=utf-8');
  return new Response(body, { status, headers });
}

function sourcesUnder(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && !entry.startsWith('.')) sourcesUnder(path, out);
    } else if (SOURCE.test(entry)) out.push(path);
  }
  return out;
}

/** Rewrite each relative import (`'./x'`, `'../x'`) with `to(specifier)`. */
function rewriteImports(code, to) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_, keyword, quote, specifier) => `${keyword}${quote}${to(specifier)}${quote}`);
}

/**
 * Where a `redirect()` sends the browser: on this site unless it says `{ external: true }`.
 * A path starting `//` or `/\` is another site to a browser, so it's written with one slash;
 * an absolute URL elsewhere (a `next` from the query string) is refused, and so is any scheme
 * that isn't http(s). `redirect(next)` after a sign-in can't send anyone off the site.
 * A control character (C0 or DEL) anywhere is refused: browsers drop tab, LF and CR from a URL,
 * so `/\t/evil.example` would arrive as `//evil.example`, another site.
 */
function checkedLocation({ location, external }, url) {
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(location)) throw new RouteError(`redirect() to ${JSON.stringify(location)}: a URL with a control character is refused`);
  if (/^[/\\]/.test(location)) {
    const path = '/' + location.replace(/^[/\\]+/, '');
    // Read the way a browser reads it: still this site, or it's refused.
    if (new URL(path, url).origin !== url.origin) throw new RouteError(`redirect() to ${JSON.stringify(location)}: not a path on this site`);
    return path;
  }
  let target;
  try {
    target = new URL(location, url);
  } catch {
    throw new RouteError(`redirect() to ${JSON.stringify(location)}: not a URL`);
  }
  if (!['http:', 'https:'].includes(target.protocol)) throw new RouteError(`redirect() to a ${target.protocol} URL is refused`);
  if (target.origin !== url.origin && !external) throw new RouteError(`redirect() to ${target.origin}, another site: say redirect(to, { external: true }) if that's meant`);
  return target.origin === url.origin ? target.pathname + target.search + target.hash : target.href;
}

// A Host header is a host and an optional port. Anything else (a path, a query, an empty one)
// would move the URL's path away from the request's: `Host: site/admin` with `GET /public` would
// read as `/admin/public`, past a proxy that allowed `/public`. That's refused (the callers answer
// 400); a request without one (HTTP/1.0) is for localhost.
const HOST = /^(?:[\w.-]+|\[[\da-fA-F:.]+\])(?::\d{1,5})?$/;
const hostOf = (req) => {
  const { host } = req.headers;
  if (host === undefined) return 'localhost';
  if (!HOST.test(host)) throw new TypeError(`not a host: ${JSON.stringify(host)}`);
  return host;
};

/**
 * A Node GET or HEAD request as a fetch Request. The path routed is `req.url`'s, and nothing
 * else: a target that isn't a path (`http://evil/staff`, `//evil/staff`) would make the URL's
 * path differ from `req.url`, past any guard the app keeps on it. That throws, as a bad Host
 * does, and `handle()` answers 400.
 */
function toRequest(req) {
  const host = hostOf(req);
  if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) throw new RouteError('a request target that is not a path');
  const protocol = req.socket?.encrypted ? 'https' : 'http';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((each) => headers.append(name, each));
    else if (value !== undefined) headers.set(name, value);
  }
  return new Request(`${protocol}://${host}${req.url}`, { method: req.method, headers });
}

async function send(response, res) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
