// @zubra/server: zubra components in a server's pages, with any template engine and no bundler.
//
//   import { createZubra } from '@zubra/server';
//   const zubra = createZubra({ components: 'components' });
//
//   const page = zubra.page();                       // one per request
//   const body = `<h1>Tickets</h1>${page.render('ticket-table', { tickets })}`;
//   res.end(page.finish(layout(body)));            // the components' CSS and modules go in
//
//   zubra.handle(req, res)    // Node: serves /_zubra/… (component modules, @zubra/runtime); false otherwise
//   zubra.fetch(request)      // the same for fetch-style servers (Hono, Bun, Deno): a Response or null
//
// And for frameworks that render the host tags themselves (React Router, Nuxt, SvelteKit,
// SolidStart, Next): `zubra.injectShadowRoots(html)` puts each shadow-DOM component's
// server-rendered template into the page as a declarative shadow root, and gives
// form-associated ones a hidden input, so the page is complete before JavaScript.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { StringDecoder } from 'node:string_decoder';
import * as nodeStream from 'node:stream';
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib';
const { Transform } = nodeStream;
import { findCompiler } from './compiler.js';
import { versionAt, versionSkew } from './versions.js';
import * as runtimeLists from '@zubra/runtime/modules';
import { createCore, joinPath, parseAttributes, propsFrom, SOURCE_EXTENSION as SOURCE, TYPES } from './core.js';

export { findCompiler, parseAttributes, propsFrom };

// `reload`: the stream's first words, how soon the browser asks again once it is lost (ms).
const RELOAD_STARTS = 'retry: 300\n\n';

// `compress`: from about a packet's worth of text up (everything served is JavaScript, CSS or
// JSON; an error's few words and a module of one line go as they are).
const SMALLEST = 1024;
const KEPT_MOST = 500;
/** Brotli if the request's `accept-encoding` takes it, else gzip if it takes that, else none. */
function encodingFor(accepts) {
  if (typeof accepts !== 'string') return null;
  const taken = new Set();
  for (const part of accepts.toLowerCase().split(',')) {
    const [name, ...params] = part.split(';').map((piece) => piece.trim());
    const q = params.find((param) => param.startsWith('q='));
    if (!q || Number(q.slice(2)) > 0) taken.add(name);
  }
  return taken.has('br') ? 'br' : taken.has('gzip') ? 'gzip' : null;
}

findCompiler(); // (points @zubra/compiler at a native CLI when its WebAssembly build is missing)
const compiler = await import('@zubra/compiler');

const posix = (path) => path.split(sep).join('/');

/**
 * `components`: the folder of `.zb` (and `.zb.jsx`/`.zb.tsx`) files. `prefix`: the URL path
 * the browser modules are served under. `cache`: keep compiled output and renders. In
 * development an edit under the folder is still picked up on the next request (the folder's
 * files are checked for changes first); `cache: false` compiles on every request instead. `production`: serve the runtime's production build, without hot
 * reloading (by default when `NODE_ENV` is `production`). `devtools`: compile for the Zubra DevTools
 * extension and serve the runtime build it reads (on by default except in production;
 * `ZUBRA_DEVTOOLS=1` turns it on there too, for a demo or a staging site). `imports`: more import map entries,
 * for packages the components import beyond `@zubra/runtime` and `@zubra/sync` (both of which
 * are served and mapped by themselves). `inline: false`: no inline `<style>` or `<script>` in a
 * page's head and scripts (stylesheet links, module scripts by `src`, and no import map: the
 * modules are served with their imports resolved), for a Content-Security-Policy without
 * `'unsafe-inline'`; `page({ nonce })` is the other way, where each response can have a nonce.
 * `bundle: true`: in production, serve the runtime as one file (`@zubra/runtime`'s `dist/bundled`):
 * a page loads `runtime/zubra.js` where it loaded `runtime/index.js` and the six modules that
 * imports, and a page's components as one module (`<prefix>/b/<names>.<hash>.js`; see `core.js`).
 * Off by default in 5.x; it has no effect in development or with the DevTools.
 *
 * Everything that doesn't need a disk is in `core.js`, shared with `edge.js` (Workers).
 * `compress: true`: `handle` and `fetch` answer in Brotli or gzip when the request takes one, each
 * file compressed once and kept; off by default, for a host with nothing in front that compresses.
 * `minify` (on in production, off with the DevTools): the component modules it sends are minified,
 * the CSS in them too, by the compiler; `false` sends them as the compiler writes them, to read.
 * `signals: true` (experimental): the runtime's reactivity on the TC39 Signals API in place of
 * Zubra's own engine (`@zubra/runtime`'s `signal-tc39.js` is served as its `signal.js`). The runtime
 * is then served file by file in production too, since its one-file builds hold Zubra's engine.
 */
export function createZubra({ components = 'components', packages = [], prefix = '/_zubra', cache = true, production = process.env.NODE_ENV === 'production', devtools = process.env.ZUBRA_DEVTOOLS === '1' || !production, imports = {}, warn, gaps, clientModules, inline, preload, bundle = false, runtime = null, onError, streamTimeout, compress = false, reload = false, signals = false, minify = production && !devtools } = {}) {
  const root = resolve(components);
  // The folder as the disk has it, links resolved: what a served module's real path must be inside.
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  if (!existsSync(root)) throw new Error(`@zubra/server: no components folder at ${root}`);
  const sourceDir = dirname(fileURLToPath(import.meta.resolve('@zubra/runtime')));
  const productionDir = join(sourceDir, '..', 'dist', 'production');
  // The Zubra DevTools need the runtime's development build, whose hook the production one leaves out.
  // In production the runtime's core and what it imports are one file (`dist/bundled/zubra.js`),
  // with `bundle` or without: one request where it was a dozen, and fewer bytes, since they
  // compress together. `bundle` also joins a page's components into one module. Development and
  // the DevTools keep the runtime file by file, as it is read and edited.
  // A runtime with a split build (`dist/split`: `zubra.js` is the base, and what only some
  // components use is in files beside it) is served from that, so a page loads only what its
  // components name; one from before it, from `dist/bundled`, whole.
  const splitDir = join(sourceDir, '..', 'dist', 'split');
  const split = runtimeLists.split && existsSync(splitDir) ? runtimeLists.split : null;
  const bundledDir = split ? splitDir : join(sourceDir, '..', 'dist', 'bundled');
  // (Signals mode: file by file, since the one-file builds hold Zubra's engine.)
  const oneFile = production && !devtools && !signals && existsSync(bundledDir);
  const bundling = Boolean(bundle) && oneFile;
  const runtimeDir = oneFile ? bundledDir : production && !devtools && existsSync(productionDir) ? productionDir : sourceDir;
  if (signals && !existsSync(join(runtimeDir, 'signal-tc39.js'))) throw new Error('@zubra/server: signals: true needs @zubra/runtime 6.0 or later, which has signals mode (signal-tc39.js)');
  if (runtime && Boolean(runtime.signals) !== Boolean(signals)) throw new Error(`@zubra/server: the built runtime was built ${runtime.signals ? 'with' : 'without'} signals: true, and this server ${signals ? 'has' : "doesn't have"} it. Build it with the same signals option`);
  const base = prefix.replace(/\/$/, '');
  const RELOAD = `${base}/reload`;
  // (Not through `warn` alone when there is none: this is about the install, said once at start.)
  const skew = versionSkew(versionAt(new URL('./package.json', import.meta.resolve('@zubra/compiler'))), versionAt(join(sourceDir, '..', 'package.json')));
  if (skew) (warn ?? console.warn)(skew);

  // @zubra/sync, for components that start with 'use collection': found from the components
  // folder (the app's own node_modules), served under <prefix>/sync/ and put in the import map,
  // so a page needs no setup for it. Not installed: such a component says so (`needs()`). In
  // production its browser modules come from its production build (`dist/production`, minified,
  // as the runtime's), where the installed version has one; its source otherwise.
  const syncSource = (() => {
    for (const from of [join(root, 'noop.js'), join(process.cwd(), 'noop.js')]) {
      try {
        return dirname(createRequire(pathToFileURL(from)).resolve('@zubra/sync'));
      } catch {}
    }
    return null;
  })();
  const syncProduction = syncSource && join(syncSource, '..', 'dist', 'production');
  const syncDir = syncSource && production && existsSync(join(syncProduction, 'connect.js')) ? syncProduction : syncSource;
  // @zubra/router, for components that start with 'use route' or 'use layout': nothing in the
  // browser needs it, but without it such a component is a page nothing serves, so say so.
  const routerInstalled = (() => {
    for (const from of [join(root, 'noop.js'), join(process.cwd(), 'noop.js')]) {
      try {
        createRequire(pathToFileURL(from)).resolve('@zubra/router');
        return true;
      } catch {}
    }
    return false;
  })();
  const needs = (name, code) => {
    if (!syncDir && code.includes('from "@zubra/sync"')) {
      throw new Error(`@zubra/server: ${relative(process.cwd(), core.pathOf(name))} starts with 'use collection', which needs @zubra/sync. Install it: npm install @zubra/sync`);
    }
    const route = !routerInstalled && core.describe(name).route;
    if (route) {
      throw new Error(`@zubra/server: ${relative(process.cwd(), core.pathOf(name))} starts with 'use ${route.kind === 'layout' ? 'layout' : 'route'}${route.pattern ? ` ${route.pattern}` : ''}', which needs @zubra/router. Install it: npm install @zubra/router`);
    }
    return code;
  };

  // name (the path without its extension, "/"-separated) → file
  const files = new Map();
  // `seen`: every file under the folder with when it was written and its size, as one string.
  const list = () => {
    const found = new Map();
    let seen = '';
    (function walk(dir) {
      for (const entry of readdirSync(dir).sort()) {
        const path = join(dir, entry);
        const stat = statSync(path, { throwIfNoEntry: false });
        if (!stat) continue; // (gone between the listing and here: an editor's temporary file)
        if (stat.isDirectory()) {
          if (entry !== 'node_modules' && !entry.startsWith('.')) walk(path);
          continue;
        }
        seen += `${path}\0${stat.mtimeMs}\0${stat.size}\n`;
        if (SOURCE.test(entry)) found.set(posix(relative(root, path)).replace(SOURCE, ''), path);
      }
    })(root);
    return { found, seen };
  };
  let { found: listed, seen } = list();
  for (const [name, path] of listed) files.set(name, path);
  // In development, with `cache`: has anything in the folder been written, added or removed
  // since this was last asked? If so the list of components is read again (a package's
  // components, added below, stay as they were listed), and the core lets go of what it kept:
  // an edit shows on the next request, with no restart and without `cache: false`'s compile per
  // request. A file a component imports from outside the folder isn't watched.
  const changed = cache && !production ? () => {
    const now = list();
    if (now.seen === seen) return false;
    seen = now.seen;
    for (const name of listed.keys()) if (!now.found.has(name)) files.delete(name);
    for (const [name, path] of now.found) files.set(name, path);
    listed = now.found;
    return true;
  } : null;

  // A package's folder of components (`@acme/kit/components`), found in the node_modules above
  // the components folder, joins the same map under its specifier, and the import map sends that
  // specifier to the same route: `@acme/kit/components/cart-panel.js` →
  // `<base>/components/@acme/kit/components/cart-panel.js`.
  const packageImports = {};
  const packageNames = [];
  for (const specifier of packages) {
    const name = specifier.replace(/\/$/, '');
    // A folder, as `exports` would give it: `./components/` matches `./components/*`.
    const found = compiler.packageFile(root, `${name}/`);
    if (found.error) {
      if (compiler.packageFile(root, name).path) throw new Error(`@zubra/server: packages: ${name} is a file; name the folder its components are in`);
      throw new Error(`@zubra/server: packages: ${found.error}`);
    }
    const dir = found.path;
    (function walk(at) {
      for (const entry of readdirSync(at).sort()) {
        const path = join(at, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (SOURCE.test(entry)) files.set(`${name}/${posix(relative(dir, path))}`.replace(SOURCE, ''), path);
      }
    })(dir);
    packageImports[`${name}/`] = `${base}/components/${name}/`;
    packageNames.push(name);
  }

  // What <prefix>/ serves besides the components' modules: @zubra/sync and the runtime, from disk.
  const assets = (rest) => {
    if (rest.startsWith('sync/') && syncDir) {
      const file = resolve(syncDir, rest.slice('sync/'.length));
      if (!file.startsWith(syncDir + sep) || extname(file) !== '.js' || !existsSync(file)) return { status: 404, type: 'text/plain', body: 'Not found' };
      return { status: 200, type: TYPES['.js'], body: readFileSync(file) };
    }
    if (rest.startsWith('runtime/')) {
      const name = rest.slice('runtime/'.length);
      // Signals mode: the TC39 engine is the runtime's engine.
      const file = resolve(runtimeDir, signals && name === 'signal.js' ? 'signal-tc39.js' : name);
      if (!file.startsWith(runtimeDir + sep) || !existsSync(file) || statSync(file).isDirectory()) return { status: 404, type: 'text/plain', body: 'Not found' };
      return { status: 200, type: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) };
    }
    return null;
  };

  const core = createCore({
    warn,
    reload,
    // A streamed prop's error: its text reaches the browser in development only (core's `rejected`).
    production,
    onError,
    streamTimeout,
    // Component modules minified (by the compiler), in production unless the DevTools are on.
    minify,
    gaps,
    clientModules,
    inline,
    preload,
    bundle: bundling,
    // Development only: it reads every tag of every finished page.
    checkPages: !production,
    changed,
    runtimeFile: oneFile ? 'zubra.js' : 'core.js',
    runtimeModules: oneFile ? split?.modules ?? runtimeLists.bundled : runtimeLists.default,
    // (A runtime from before the split has no such list, and is served as it was.)
    runtimeSplit: split,
    // Experimental: the app's own build of the runtime (`buildRuntime()`), in production only.
    runtimeBuilt: production && !devtools ? runtime ?? null : null,
    // The compiler keys a context by its module's path, joined to the importing component's.
    contextKey: ({ module, export: name }) => `${joinPath(posix(root), module)}#${name}`,
    // A `.js` file in the components folder, served as it is (core serves only those a browser
    // module imports, so a hidden folder's files stay unserved unless one does). Never one a link
    // leads out of the folder to.
    localModule: (path) => {
      const file = resolve(root, path);
      if (!file.startsWith(root + sep) || extname(file) !== '.js' || !existsSync(file) || statSync(file).isDirectory()) return null;
      if (!realpathSync(file).startsWith(realRoot + sep)) return null;
      return { status: 200, type: TYPES['.js'], body: readFileSync(file) };
    },
    request: (body) => compiler.request(body),
    files,
    fromPackage: (name) => packageNames.some((specifier) => name.startsWith(`${specifier}/`)),
    sourcesOf: (path) => compiler.sources(path),
    cache,
    devtools,
    base,
    imports: { ...packageImports, ...imports },
    syncImports: syncDir ? { '@zubra/sync': `${base}/sync/index.js`, '@zubra/sync/connect': `${base}/sync/connect.js`, '@zubra/sync/follow': `${base}/sync/follow.js` } : {},
    needs,
    where: root,
    assets,
  });

  /** Node's http (and Express, Koa, Fastify's raw request): true when it answered. */
  function handle(req, res) {
    // `//host/_zubra/…` would read as a path of the URL's host: not ours, as the router's isn't.
    if (typeof req.url !== 'string' || !req.url.startsWith('/') || req.url.startsWith('//')) return false;
    // `reload`: the stream a page keeps open. Nothing is sent on it but how soon to ask again:
    // that it ends when this process does, and opens when the next one is up, is the message.
    if (reload && new URL(req.url, 'http://x').pathname === RELOAD) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
      res.write(RELOAD_STARTS);
      return true;
    }
    const served = core.serve(new URL(req.url, 'http://x').pathname);
    if (!served) return false;
    const path = new URL(req.url, 'http://x').pathname;
    const { body, headers } = compress ? encoded(served, path, req.headers?.['accept-encoding']) : { body: served.body, headers: {} };
    res.writeHead(served.status, { 'content-type': served.type, 'cache-control': core.cacheControlOf(served), ...headers });
    res.end(body);
    return true;
  }

  // `compress`: what `handle` and `fetch` answer goes out in Brotli or gzip when the request
  // says it reads one. A file is compressed once and kept, by its path, for as long as it is
  // the same text. Files that stay as they are until a restart get the smallest encoding
  // (Brotli 11 takes about 36 ms for the runtime's base, once); ones an edit may change (in
  // development, or with `cache: false`) a quick one.
  const lasting = cache && !changed;
  const kept = new Map();
  const same = (a, b) => (typeof a === 'string' ? a === b : typeof b !== 'string' && a.equals(b));
  function encoded(served, path, accepts) {
    const { body } = served;
    if (Buffer.byteLength(body) < SMALLEST) return { body, headers: {} };
    // `vary` on the plain answer too: a shared cache must not hand it to a browser that asked for Brotli, or the reverse.
    const headers = { vary: 'accept-encoding' };
    const encoding = encodingFor(accepts);
    if (!encoding) return { body, headers };
    let entry = kept.get(path);
    if (!entry || !same(entry.body, body)) {
      // A path can be spelled without end (`%7A` for `z`), so what is kept has a limit.
      if (kept.size >= KEPT_MOST) kept.clear();
      kept.set(path, (entry = { body }));
    }
    entry[encoding] ??= encoding === 'br'
      ? brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: lasting ? 11 : 4, [zlib.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(body) } })
      : gzipSync(body, { level: lasting ? 9 : 6 });
    return { body: entry[encoding], headers: { ...headers, 'content-encoding': encoding, 'content-length': String(entry[encoding].length) } };
  }

  /** `fetch` with `reload`: the stream, as a Response whose body stays open. */
  const reloadStream = () => new Response(new ReadableStream({ start: (controller) => controller.enqueue(new TextEncoder().encode(RELOAD_STARTS)) }), { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } });
  const fetchPlain = reload ? async (request) => (new URL(request.url).pathname === RELOAD ? reloadStream() : core.fetch(request)) : core.fetch;

  /** `fetch` with `compress`: core's answer, encoded the same way. */
  async function fetchEncoded(request) {
    const path = new URL(request.url).pathname;
    if (reload && path === RELOAD) return reloadStream();
    const served = core.serve(path);
    if (!served) return null;
    const { body, headers } = encoded(served, path, request.headers.get('accept-encoding'));
    return new Response(body, { status: served.status, headers: { 'content-type': served.type, 'cache-control': core.cacheControlOf(served), ...headers } });
  }

  /** One page, as in core.js, and `stream(html)`: the same chunks as a Node Readable. */
  function page(options) {
    const one = core.page(options);
    one.stream = (html) => nodeStream.Readable.from(one.chunks(html));
    return one;
  }

  /**
   * For static sites: write every component's browser module and @zubra/runtime under `dir`, at
   * the paths the pages import (`<dir>/_zubra/components/…`, `<dir>/_zubra/runtime/…`), and with
   * `inline: false` each component's stylesheet beside its module.
   */
  function writeAssets(dir) {
    const out = join(resolve(dir), ...base.split('/').filter(Boolean));
    for (const name of files.keys()) {
      const file = join(out, 'components', `${name}.js`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, core.module(name));
    }
    // `bundle`: the joined modules of the pages rendered so far, at the URLs those pages name.
    for (const { url, body } of core.joinedModules()) {
      const file = join(resolve(dir), ...url.split('/').filter(Boolean));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
    cpSync(runtimeDir, join(out, 'runtime'), { recursive: true });
    if (signals) cpSync(join(runtimeDir, 'signal-tc39.js'), join(out, 'runtime', 'signal.js'));
    if (syncDir) cpSync(syncDir, join(out, 'sync'), { recursive: true, filter: (from) => !from.endsWith('.d.ts') });
    if (inline !== false) return;
    // `inline: false`: the pages link each component's stylesheet, and have no import map, so
    // the copied modules' own bare imports (the runtime's, @zubra/sync's) are resolved here.
    for (const name of files.keys()) {
      const css = core.css(name);
      if (css) writeFileSync(join(out, 'components', `${name}.css`), css);
    }
    (function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (extname(path) === '.js') writeFileSync(path, core.resolveImports(readFileSync(path, 'utf8')));
      }
    })(out);
  }

  /**
   * `injectShadowRoots` for a streamed page (React's renderToPipeableStream, any Node stream of
   * HTML): a Transform that passes the page through as it comes, holding back only an unfinished
   * tag at the end of a chunk until the next one completes it.
   */
  function injectShadowRootsStream(options) {
    const decoder = new StringDecoder('utf8');
    let carry = '';
    // One count of hosts for the whole stream, and what the last piece ended inside.
    options = { ...options, hosts: { count: 0 }, state: {} };
    const pass = (text, flush) => {
      const all = carry + text;
      // Hold back from an unclosed `<` (a tag cut in two), and from an opened host tag whose
      // next characters might start its <template> (to not inject twice): flushing at '>'.
      const open = flush ? -1 : all.lastIndexOf('<');
      let cut = open > all.lastIndexOf('>') ? open : all.length;
      // A host's start tag near the end: what follows may be its own <template> (a React
      // wrapper renders it), so wait for more before deciding.
      const { pattern } = core.shadowHosts(options?.lightDom);
      if (!flush && pattern) {
        let last = null;
        for (const found of pattern.hosts(all.slice(0, cut), { ...options.state })) last = found;
        if (last && cut - last.end < 64) cut = last.index;
      }
      carry = all.slice(cut);
      return core.injectShadowRoots(all.slice(0, cut), options);
    };
    return new Transform({
      transform(chunk, _encoding, callback) {
        callback(null, pass(decoder.write(chunk), false));
      },
      flush(callback) {
        callback(null, pass(decoder.end(), true));
      },
    });
  }

  return {
    writeAssets,
    injectShadowRootsStream,
    module: core.module,
    names: core.names,
    describe: core.describe,
    render: core.render,
    page,
    handle,
    fetch: compress ? fetchEncoded : fetchPlain,
    importMap: core.importMap,
    head: core.head,
    scripts: core.scripts,
    injectShadowRoots: core.injectShadowRoots,
  };
}
