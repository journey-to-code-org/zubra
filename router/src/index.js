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
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findCompiler } from '@zubra/server';
import { buildTable, matcher, RouteError } from './table.js';

export { RouteError };

const SOURCE = /\.zb(?:\.[jt]sx)?$/;

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
 * resolve from there, so keep it inside the project). `onError(error, request)`: called when a
 * `load` throws; the browser gets a plain 500, never the message.
 */
export async function createRouter({
  zubra,
  components = 'components',
  cacheDir = join(process.cwd(), 'node_modules', '.cache', 'zubra-router'),
  onError = (error) => console.error(error),
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
    if (!info.route) continue;
    const name = relative(root, path).split(sep).join('/').replace(SOURCE, '');
    const file = relative(process.cwd(), path);
    entries.push({ name, file, props: info.props.map((prop) => prop.name), route: info.route });
    if (info.route.load) halves.set(name, path);
  }
  const { pages, layouts } = buildTable(entries);
  const propsOf = new Map(entries.map((entry) => [entry.name, new Set(entry.props)]));

  // The server halves of those with a `load`, written to the cache and imported. Their relative
  // imports point back at the source; each is written beside its place and renamed in, so a
  // second process starting at the same moment never imports half a file.
  const loads = new Map();
  for (const [name, path] of halves) {
    const response = compile({ emit: 'server', path, files: read(path) });
    if (!response.ok) throw new Error(response.error);
    const module = join(cacheDir, `${name.split('/').join('__')}.route.mjs`);
    const writing = `${module}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(writing, rewriteImports(response.output, (specifier) => pathToFileURL(resolve(dirname(path), specifier)).href));
    renameSync(writing, module);
    loads.set(name, (await import(`${pathToFileURL(module).href}?t=${Date.now()}`)).load);
  }

  const match = matcher(pages, await urlPattern());

  /** A Response for a GET or HEAD to a route, or null. */
  async function respond(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const url = new URL(request.url);
    const found = match(url.pathname);
    if (!found) return null;
    const { page, params } = found;
    const declared = propsOf.get(page.name);
    const props = {};
    for (const [key, value] of Object.entries(params)) if (declared.has(key)) props[key] = value;
    const load = loads.get(page.name);
    if (load) {
      let loaded;
      try {
        loaded = await load({ params, url, request });
      } catch (error) {
        onError(error, request);
        return text(500, 'Internal error');
      }
      // Props the page declares; anything else `load` returns doesn't reach it.
      for (const [key, value] of Object.entries(loaded ?? {})) if (declared.has(key)) props[key] = value;
    }
    const rendering = zubra.page();
    const body = rendering.render(page.name, props);
    const html = rendering.finish(`<!doctype html>\n<html><head><meta charset="utf-8"></head><body>${body}</body></html>`);
    return new Response(request.method === 'HEAD' ? null : html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  /** Node's http: answers a route and returns true, or returns false. */
  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    let request;
    try { request = toRequest(req); } catch { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return true; }
    const response = await respond(request);
    if (!response) return false;
    await send(response, res);
    return true;
  }

  /** For `http.createServer(router.listener)`: a route, or a plain 404. */
  async function listener(req, res) {
    if (!(await handle(req, res))) res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }

  return {
    handle,
    listener,
    fetch: respond,
    /** The pages, most specific first: `[{ name, pattern, params, load }]`. */
    routes: () => pages.map(({ name, pattern, params, load }) => ({ name, pattern, params, load })),
    /** The layouts found (served from stage A3). */
    layouts: () => layouts.map(({ name, pattern, root }) => ({ name, pattern, root })),
    /** Which page a path goes to: `{ name, pattern, params }`, or null. */
    match: (pathname) => {
      const found = match(pathname);
      return found && { name: found.page.name, pattern: found.page.pattern, params: found.params };
    },
  };
}

const text = (status, body) => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });

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

/** A Node GET or HEAD request as a fetch Request. */
function toRequest(req) {
  const host = req.headers.host ?? 'localhost';
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
  for (const [name, value] of response.headers) res.setHeader(name, value);
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
