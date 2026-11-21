// @zubra/actions: serve a component's 'use server' functions, over plain form posts.
//
//   import { createActions } from '@zubra/actions';
//   const actions = await createActions({ components: 'components' });
//
//   actions.fetch(request)     // fetch-style servers (Hono, Bun, Deno): a Response, or null if not ours
//   actions.handle(req, res)   // Node's http: true if it answered
//   actions.result(request)    // after a no-JavaScript post: { action, value } once, else null
//   actions.script()           // <script> for the page: enhances those forms into fetch requests
//   actions.formsScript()      // <script> for plain forms that name what they update (experimental)
//
// The contract (plan/actions-design.md):
// - A form posts to /_zb/action/<tag>/<name> with its own encoding; the function gets the FormData.
// - `Accept: application/json` (the enhanced path) gets the return value as JSON.
// - Anything else (the browser's own post) gets 303 See Other back to the page it came from, with
//   the return value in a one-use cookie, so the page can render it (`result()`).
// - A cross-site post is refused (Origin / Sec-Fetch-Site), so forms on other sites can't call it.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { brotliCompress, gzip as gzipCallback, constants as zlib } from 'node:zlib';
import { createActionsCore, routesFrom, MOUNT, SCRIPT_PATH, FORMS_PATH, COOKIE, SECURE_COOKIE } from './core.js';
import { flatName, rewriteImports, serverHalves } from './compile.js';

export { MOUNT, SCRIPT_PATH, COOKIE, SECURE_COOKIE };

/**
 * Development is opt-in, as in `@zubra/server`: `NODE_ENV=development`, or `production: false`.
 * Anything else, unset included, is production.
 */
const developmentByDefault = () => process.env.NODE_ENV === 'development';
const brotli = promisify(brotliCompress);
const gzip = promisify(gzipCallback);

// The two browser scripts: as written (src/) in development, minified (dist/production, built by
// scripts/build-production.js) in production, where they are about half the bytes.
const script = (file, production) => readFileSync(new URL(production ? `../dist/production/${file}` : `./${file}`, import.meta.url), 'utf8');

/**
 * `context({ request, req, c })`: what else a server function gets beside `request`, per request
 * (the signed-in user, a database handle). `req` is Node's request (Node, Express, Fastify), `c`
 * Hono's context. It may be async; what it returns is spread into the function's second argument.
 *
 * `components`: the folder of `.zb` files. `cacheDir`: where the server halves are written
 * (bare imports resolve from there, so keep it inside the project). `origins`: other origins
 * allowed to post (behind a proxy that rewrites Origin, say). `onError(error, request)`: called
 * when a function throws; the client gets a generic error, never the message or stack.
 * `secure`: true when the app is served over HTTPS even though requests reach it as http (behind a
 * proxy that ends TLS), so the result cookie is `__Host-` and `Secure`; false never; unset, each
 * request's own protocol.
 * `maxBytes`: the largest post read, files and fields together (10 MB by default; `Infinity`
 * for none). A bigger one gets `{ error: 'Too large' }` (413) and the function doesn't run.
 * `production`: serve the browser scripts minified (by default unless `NODE_ENV` is `development`),
 * and refuse to start when a component doesn't compile. In development that component is left
 * out with a warning, so a half-written file doesn't take the server down: its page shows the
 * error when it is rendered, and its functions are served again once it compiles and the server
 * restarts.
 * `compress: true`: the browser scripts go in Brotli or gzip to a request that takes one, each
 * compressed once at start (as `@zubra/server`'s `compress`); off by default, for a host that
 * compresses already.
 */
export async function createActions({
  components = 'components',
  cacheDir = join(process.cwd(), 'node_modules', '.cache', 'zubra-actions'),
  origins = [],
  onError = (error) => console.error(error),
  context = () => ({}),
  maxBytes,
  secure,
  production = !developmentByDefault(),
  compress = false,
} = {}) {
  const root = resolve(components);
  if (!existsSync(root)) throw new Error(`@zubra/actions: no components folder at ${root}`);
  mkdirSync(cacheDir, { recursive: true });

  // URL → function, from every component's server half.
  const maps = [];
  const broken = production
    ? undefined
    : (path, message) => console.warn(`@zubra/actions: ${relative(root, path)} doesn't compile, so its server functions aren't served until it does and the server restarts.\n${message}`);
  for (const { path, output } of await serverHalves(root, { broken })) {
    const module = join(cacheDir, `${flatName(relative(root, path))}.server.mjs`);
    // The server half lives in the cache folder, so its relative imports point back at the source.
    // Written beside it and renamed into place, so another process starting at the same moment
    // (a second worker, a parallel test) never imports a half-written file and finds no actions.
    const writing = `${module}.${process.pid}.${randomUUID()}.tmp`;
    const source = rewriteImports(output, (specifier) => pathToFileURL(resolve(dirname(path), specifier)).href);
    writeFileSync(writing, source);
    try {
      renameSync(writing, module);
    } catch (error) {
      let alreadyWritten = false;
      try {
        alreadyWritten = ['EEXIST', 'EPERM'].includes(error.code) && existsSync(module) && readFileSync(module, 'utf8') === source;
      } finally {
        unlinkSync(writing);
      }
      if (!alreadyWritten) throw error;
    }
    maps.push((await import(`${pathToFileURL(module).href}?t=${Date.now()}`)).actions);
  }
  const client = script('client.js', production);
  const forms = script('enhance-forms.js', production);
  const encodings = compress ? Object.fromEntries(await Promise.all([[SCRIPT_PATH, client], [FORMS_PATH, forms]].map(async ([path, source]) => [path, {
    br: await brotli(source, { params: { [zlib.BROTLI_PARAM_QUALITY]: 11, [zlib.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(source) } }),
    gzip: await gzip(source, { level: 9 }),
  }]))) : null;
  // The scripts don't change while the server runs: cached as @zubra/server caches the runtime.
  const scriptCaching = production ? 'public, max-age=3600' : 'no-cache';
  const core = createActionsCore({ routes: routesFrom(...maps), client, forms, origins, onError, context, maxBytes, secure, scriptCaching, encodings });

  /** Node's http: answers ours and returns true, or returns false without reading the body. */
  async function handle(req, res) {
    if (!req.url.startsWith(MOUNT) && !req.url.startsWith(SCRIPT_PATH)) return false;
    let request;
    // A Host header that isn't a host (`[::1`) can't make a URL: a 400, not an unhandled
    // rejection that ends the process.
    try { request = toRequest(req); } catch { res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request'); return true; }
    const response = await core.fetch(request, { req });
    if (!response) return false;
    await send(response, res);
    return true;
  }

  return { ...core, handle };
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

/** A Node request as a fetch Request (the body streams; nothing is read until it's ours). */

export function toRequest(req) {
  const host = hostOf(req);
  const protocol = req.socket?.encrypted ? 'https' : 'http';
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((each) => headers.append(name, each));
    else if (value !== undefined) headers.set(name, value);
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : bodyOf(req);
  return new Request(`${protocol}://${host}${req.url}`, { method: req.method, headers, body, duplex: 'half' });
}

/**
 * A Node request's body as a web stream. Cancelling it (a post over maxBytes) discards the rest
 * rather than destroying the request, so the connection survives to carry the answer: a browser
 * still sending gets it instead of a reset. Node discards what's left once the response ends.
 */
function bodyOf(req) {
  let data;
  return new ReadableStream({
    start(controller) {
      data = (chunk) => controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      req.on('data', data);
      req.once('end', () => {
        try {
          controller.close();
        } catch {}
      });
      req.once('error', (error) => {
        try {
          controller.error(error);
        } catch {}
      });
    },
    cancel() {
      req.off('data', data);
      req.resume();
    },
  });
}

/** Write a fetch Response to a Node response. */
export async function send(response, res) {
  res.statusCode = response.status;
  for (const [name, value] of response.headers) {
    if (name === 'set-cookie') continue;
    res.setHeader(name, value);
  }
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
