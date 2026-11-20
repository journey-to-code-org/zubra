// The part of @zubra/server that needs no host: it takes the compiler's `request` and the
// components' paths and sources, and does everything else: rendering, CSS, browser modules, a
// page's head and scripts, streaming, and shadow roots for frameworks' HTML. It imports nothing
// from Node and never looks at `import.meta`, so it runs in Cloudflare Workers and Deno as well
// as Node. `index.js` is this plus the file system (finding the components, serving the runtime
// from disk); `edge.js` is this plus a map of sources and the compiler's WebAssembly module.

const SOURCE_EXTENSION = /\.zb(?:\.[jt]sx)?$/;
const escapeAttribute = (text) => String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const escapeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

export { SOURCE_EXTENSION, TYPES };

// The renders kept for asking again (see `answer` in `createCore`): how many, how many characters
// of keys and HTML in all, and the largest one answer may be.
const RENDERS = 500;
const RENDER_BYTES = 8 * 1024 * 1024;
const RENDER_LARGEST = 512 * 1024;
// How long a streamed prop may stay pending before its region is rejected (`streamTimeout`).
const STREAM_TIMEOUT = 30_000;

// Half of a surrogate pair: a high one not followed by a low one, or a low one not after a high one.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const wellFormed = (text) => (typeof text.isWellFormed === 'function' ? text.isWellFormed() : !LONE_SURROGATE.test(text));
const toWellFormed = (text) => (typeof text.toWellFormed === 'function' ? text.toWellFormed() : text.replace(new RegExp(LONE_SURROGATE.source, 'g'), '\uFFFD'));

function checkTimeout(value) {
  if (typeof value !== 'number' || !(value >= 0)) throw new Error(`@zubra/server: streamTimeout is a number of milliseconds (0 for no limit), not ${String(value)}`);
}

/**
 * `request(body)`: the compiler (`{ ok, output, error }`). `files`: a Map from component name
 * (the path without its extension, "/"-separated) to the path its source is known by.
 * `sourcesOf(path)`: that component's source and the sources of the components it imports, by
 * path. `where`: how an error names the place the components came from. `assets(rest)`: what the
 * host serves under `<base>/` beyond the components' modules (`{ status, type, body }` or null).
 * `needs(name, code)`: the host's check on a compiled module (a package it needs being installed).
 */
/** How many different warnings a server remembers having said (see warnOnce). */
const WARNED_MOST = 1000;

/** Marks an error as the compiler's verdict on a component (not a crash of the server's). */
const COMPILE_ERROR = Symbol('zubra.compileError');

/** The compiler's error text as an Error, without its leading `error: ` (printed as `Error: …`). */
export function compileError(text) {
  return Object.assign(new Error(String(text).replace(/^error:\s*/, '')), { [COMPILE_ERROR]: true });
}

export function createCore({ reload, request, files, fromPackage = () => false, sourcesOf: readSources, cache = true, devtools = false, base, imports = {}, syncImports = {}, needs = (_name, code) => code, where = 'the components', assets = () => null, warn = (message) => console.warn(message), gaps = 'warn', clientModules = 'all', inline = true, preload = true, bundle = false, checkPages = false, changed = null, runtimeFile = bundle ? 'zubra.js' : 'core.js', runtimeModules = {}, runtimeSplit = null, runtimeBuilt = null, localModule = () => null, contextKey = ({ module, export: name }) => `${joinPath('', module)}#${name}`, production = false, onError = null, streamTimeout = STREAM_TIMEOUT, minify = false }) {
  if (gaps !== 'warn' && gaps !== 'ignore') throw new Error(`@zubra/server: gaps is "warn" or "ignore", not ${JSON.stringify(gaps)}`);
  if (clientModules !== 'all' && clientModules !== 'needed') throw new Error(`@zubra/server: clientModules is "all" or "needed", not ${JSON.stringify(clientModules)}`);
  if (typeof inline !== 'boolean') throw new Error(`@zubra/server: inline is true or false, not ${JSON.stringify(inline)}`);
  if (typeof preload !== 'boolean') throw new Error(`@zubra/server: preload is true or false, not ${JSON.stringify(preload)}`);
  checkTimeout(streamTimeout);
  if (onError !== null && typeof onError !== 'function') throw new Error('@zubra/server: onError is a function (error, { component, prop })');
  const memo = new Map();
  // `changed` (the Node server in development, with `cache`): asked whether the sources differ
  // from when it was last asked, at most once per run of synchronous work (a render, a request
  // for a module), before anything kept is used. If they do, everything kept goes, so an edit
  // shows on the next request with no restart, and a page that hasn't changed still costs what
  // `cache` makes it cost.
  let checked = false;
  const fresh = () => {
    if (!changed || checked) return;
    checked = true;
    queueMicrotask(() => {
      checked = false;
    });
    if (!changed()) return;
    memo.clear();
    forgotten();
  };
  let forgotten = () => {};
  const once = (key, make) => {
    fresh();
    if (!cache || !memo.has(key)) memo.set(key, make());
    return memo.get(key);
  };
  const pathOf = (name) => {
    const path = files.get(name) ?? files.get(byTag().get(name));
    if (!path) {
      // The nearest name, if one is a slip away (a letter or two).
      const near = [...files.keys()].map((have) => [distance(name, have), have]).filter(([far]) => far <= 2).sort(([a], [b]) => a - b)[0]?.[1];
      throw new Error(`@zubra/server: no component "${name}" in ${where}${near ? `: did you mean "${near}"?` : ''} (have: ${[...files.keys()].join(', ')})`);
    }
    return path;
  };
  const sourcesOf = (path) => once(`sources:${path}`, () => readSources(path));
  /**
   * A request about a component, its sources sent once. The compiler keeps a set of files
   * under a handle (`command: 'load'`), and a request that names the handle doesn't carry
   * them: for a small component the sources were most of the request, and reading them most
   * of the work. A compiler that doesn't have the handle (a new instance after a crash, one
   * that let the set go) says `reload`, and gets the files again.
   *
   * Only with `cache`, where a component's sources are read once and so are the same object
   * each time (without it they are read again for every request, to pick up edits). And not
   * with a compiler that doesn't keep what it loads (an older one, or a process per request):
   * after one try, the files go with every request as before.
   */
  const handles = new WeakMap(); // a component's sources → their handle
  let loads = cache;
  const send = (body) => {
    if (!loads) return request(body);
    const { files: sources, ...rest } = body;
    for (let attempt = 0; attempt < 2; attempt++) {
      let handle = handles.get(sources);
      if (handle === undefined) {
        const loaded = request({ command: 'load', files: sources });
        // (An older compiler doesn't know `load`: its answer has no handle.)
        if (typeof loaded.output !== 'string') break;
        handle = loaded.output;
        handles.set(sources, handle);
      }
      const response = request({ ...rest, loaded: handle });
      if (!response.reload) return response;
      handles.delete(sources);
    }
    loads = false;
    return request(body);
  };
  const call = (path, body) => {
    const response = send({ path, files: sourcesOf(path), ...body });
    if (!response.ok) throw compileError(response.error);
    return response.output;
  };

  /** Each component's interface: `{ tag, shadow, form, props: [{ name, attribute, type, default, model }] }`. */
  const describe = (name) => once(`interface:${name}`, () => JSON.parse(call(pathOf(name), { emit: 'interface' })));
  /** A component's own source, without its comments: two copies of one component compare equal. */
  const ownSource = (name) => {
    const path = pathOf(name);
    const sources = sourcesOf(path);
    return String(sources[path] ?? Object.values(sources)[0] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim();
  };
  /**
   * Which component each tag is, and which package components the app's own stand in for. An
   * app's component and a package's with one tag (both carrying a copy of a shared part, say):
   * the app's wins everywhere, the package's own imports of it included, and if the two copies
   * differ the server says so. Two of the app's, or two packages', with one tag is an error.
   */
  const warned = new Set();
  /**
   * Say `message` once. Forgotten after WARNED_MOST others, so a server that runs for months
   * doesn't keep every message it said: some name a place in the data (a prop's index).
   */
  const warnOnce = (message) => {
    if (warned.has(message)) return;
    if (warned.size >= WARNED_MOST) warned.clear();
    warned.add(message);
    warn(message);
  };
  const owners = () =>
    once('tags', () => {
      const tags = new Map();
      const shadows = new Map();
      // `files` lists the app's components before any package's, so the app's copy is kept.
      for (const name of files.keys()) {
        const { tag } = describe(name);
        const kept = tags.get(tag);
        if (kept === undefined) {
          tags.set(tag, name);
          continue;
        }
        if (fromPackage(kept) || !fromPackage(name)) throw new Error(`@zubra/server: <${tag}> is defined by both ${kept} and ${name}`);
        shadows.set(name, kept);
        // Once per server, even with `cache: false` (which works this out again for each render).
        const message = `@zubra/server: <${tag}> is the app's ${kept}, in place of ${name}, which differs from it: the package's components get the app's`;
        if (!warned.has(message) && ownSource(name) !== ownSource(kept)) warnOnce(message);
      }
      return { tags, shadows };
    });
  const byTag = () => owners().tags;
  /** A component name or tag as the component that answers for it (the app's, for a shadowed package one). */
  const nameOf = (nameOrTag) => (files.has(nameOrTag) ? (fromPackage(nameOrTag) ? owners().shadows.get(nameOrTag) ?? nameOrTag : nameOrTag) : byTag().get(nameOrTag));

  // `idPrefix`: renders that end up in one page number their hosts' ids apart (`id()`).
  // `context`: the values the page provides (`page.provide()`), by context key.
  // A component's HTML is a function of its sources and what it is rendered with, and nothing
  // else: the compiler evaluates only what is deterministic. So with `cache` (where the sources
  // are read once), a render asked for again with the same props, slots, context and id prefix
  // is answered from the last one: a page's navigation, its forms, a list that hasn't changed.
  // The most recently used are kept, within `RENDERS` entries and `RENDER_BYTES` characters; one
  // answer larger than `RENDER_LARGEST` isn't kept. A promise prop is never the same twice.
  const rendered = new Map();
  let renderedSize = 0;
  forgotten = () => {
    rendered.clear();
    renderedSize = 0;
  };
  const answer = (name, props, slots, pending, idPrefix, context) => {
    fresh();
    const path = pathOf(name);
    const ask = () => send({ path, files: sourcesOf(path), emit: 'html', props, slots, slotSource: 'html', partial: true, ...(gaps === 'warn' ? { gaps: true } : {}), ...(pending.length ? { pending } : {}), ...(idPrefix ? { idPrefix } : {}), ...(Object.keys(context).length ? { context } : {}) });
    if (!cache || pending.length) return ask();
    // What the request would say, as it would say it (JSON), so two keys are equal exactly when
    // the two requests are.
    const key = `${path}\n${idPrefix}\n${JSON.stringify([props, slots, context])}`;
    const kept = rendered.get(key);
    if (kept !== undefined) {
      rendered.delete(key); // (moved to the end: the most recently used)
      rendered.set(key, kept);
      return kept;
    }
    const response = ask();
    const size = key.length + (response.ok ? response.output.length : 0);
    if (!response.ok || size > RENDER_LARGEST) return response;
    rendered.set(key, response);
    renderedSize += size;
    for (const [oldest, old] of rendered) {
      if (rendered.size <= RENDERS && renderedSize <= RENDER_BYTES) break;
      rendered.delete(oldest);
      renderedSize -= oldest.length + old.output.length;
    }
    return response;
  };
  const render = (name, props = {}, slots = {}, pending = [], idPrefix = '', context = {}) => {
    // (The tag is looked up only for a message: asking for it would be a request of its own.)
    props = sendable(props, (path) => `<${tagOf(name)}>'s prop ${path}`);
    slots = sendable(slots, (path) => `<${tagOf(name)}>'s slot ${path}`);
    context = sendable(context, () => `<${tagOf(name)}>'s context`);
    const response = answer(name, props, slots, pending, idPrefix, context);
    if (!response.ok) throw compileError(response.error);
    // A value that isn't a safe URL (a user's `javascript:` link) is left out, as the element
    // leaves it out in the browser; the page still renders, and this says what was dropped.
    for (const message of response.omitted ?? []) warn(`@zubra/server: <${name}>: ${message}`);
    // What the server couldn't compute and left for the browser (a list derived through `Intl`,
    // a formatted date): empty in the HTML, so without JavaScript, and until the module loads,
    // that part is missing. Said once per place, as `zubra check --server` says it.
    for (const gap of response.gaps ?? []) {
      const message = `@zubra/server: <${name}> leaves part of its HTML for the browser (empty without JavaScript). Compute it before rendering and pass it as a prop, or pass gaps: 'ignore' if that's intended.\n${gap}`;
      warnOnce(message);
    }
    return response.output;
  };
  const css = (name) => once(`css:${name}`, () => call(pathOf(name), { emit: 'css' }));
  /** A component's tag, for messages; its name when it has none to give (it doesn't compile). */
  function tagOf(name) {
    try {
      return describe(name).tag;
    } catch {
      return name;
    }
  }
  /**
   * Props, slots or context as the compiler can read them (JSON). A number JSON can't carry
   * (NaN, ±Infinity) or a BigInt is refused here, naming the component and where in the value
   * it was, instead of arriving as null or failing in JSON.stringify. A string with half of a
   * surrogate pair (text cut inside an emoji) is repaired to U+FFFD and reported: one stored
   * value shouldn't make every page that shows it an error page. What JSON leaves out (a
   * function, a symbol, undefined) it still leaves out: frameworks pass event handlers through
   * props. A value is copied only where something in it was repaired.
   */
  function sendable(value, where) {
    const ancestors = new Set();
    const walk = (value, path) => {
      if (typeof value === 'string') {
        if (wellFormed(value)) return value;
        const message = `@zubra/server: ${where(path)} has half of a surrogate pair (text cut inside an emoji or another character outside the BMP); it is shown as U+FFFD. Fix the stored text, or call toWellFormed() on it.`;
        warnOnce(message);
        return toWellFormed(value);
      }
      if (typeof value === 'number') {
        if (Number.isFinite(value)) return value;
        throw new Error(`@zubra/server: ${where(path)} is ${value}, which JSON can't carry (it would arrive as null). Pass a finite number, or null for none`);
      }
      if (typeof value === 'bigint') throw new Error(`@zubra/server: ${where(path)} is a BigInt, which JSON can't carry. Pass it as a number or a string`);
      // (A value with toJSON, a Date among them, is what toJSON gives; a cycle is JSON's to report.)
      if (!value || typeof value !== 'object' || typeof value.toJSON === 'function' || typeof value.then === 'function' || ancestors.has(value)) return value;
      ancestors.add(value);
      let copy = null;
      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          const next = walk(item, `${path}[${index}]`);
          if (next !== item) (copy ??= [...value])[index] = next;
        });
      } else {
        for (const [key, item] of Object.entries(value)) {
          const next = walk(item, path ? `${path}.${key}` : key);
          if (next !== item) (copy ??= { ...value })[key] = next;
        }
      }
      ancestors.delete(value);
      return copy ?? value;
    };
    return walk(value, '');
  }
  /**
   * The plain `.js` modules in the components folder that the browser imports: those a
   * component's browser module imports by relative path, and those they import in turn. Paths
   * relative to the folder. A module only a `'use server'` function imports isn't among them.
   */
  const browserModules = () => once('browser-modules', () => {
    const found = new Set();
    const queue = [];
    const add = (from, specifier) => {
      const folder = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
      // (One that leaves the folder, a binder of the runtime's beside it (`../runtime/await.js`),
      // isn't a module of the components'.)
      if (specifier.split('/').filter((part) => part === '..').length > (folder ? folder.split('/').length : 0)) return;
      const path = joinPath(folder, specifier);
      if (path.endsWith('.js') && !found.has(path)) {
        found.add(path);
        queue.push(path);
      }
    };
    for (const name of files.keys()) {
      let code;
      try {
        code = js(name);
      } catch {
        continue; // a component that doesn't compile imports nothing
      }
      for (const specifier of relativeImports(code)) add(name, specifier);
    }
    while (queue.length) {
      const path = queue.shift();
      const module = localModule(path);
      if (module) for (const specifier of relativeImports(String(module.body))) add(path, specifier);
    }
    return found;
  });
  /**
   * `minify` (production): a module this server sends, minified by the compiler, its CSS too
   * (`command: "minify"`). Last, after everything here that reads the module as the compiler
   * wrote it. A compiler from before the command answers that it doesn't know it, and the module
   * goes as it is.
   */
  const shrink = (code) => {
    if (!minify) return code;
    const response = request({ command: 'minify', code: String(code) });
    return response.ok ? response.output : code;
  };
  // `stylesHref`: for a module of a page that carries the component's CSS, the stylesheet's
  // address in place of its text (a light-DOM component's; see the joined module below).
  // (As the compiler writes it: what `join` takes, since modules minified alone have names that
  // collide once joined. `js` is what a page is sent.)
  const compiled = (name, stylesHref) => once(`js:${name}${stylesHref ? `:${stylesHref}` : ''}`, () => {
    const path = pathOf(name);
    // `binderEntries`: a block's or slot's binder comes from its own runtime entry, so a page loads
    // only the binders its components use (`@zubra/runtime` is mapped to the core, below). Those
    // imports are written as the files' addresses, so a page with an import map of its own (a
    // framework's, naming only `@zubra/runtime`) loads them too.
    const response = send({ emit: 'js', runtime: '@zubra/runtime', devtools, binderEntries: true, path, files: sourcesOf(path), ...(stylesHref ? { stylesHref } : {}) });
    if (!response.ok) throw compileError(response.error);
    return resolved(routed(resolveImports(older(name, String(needs(name, response.output))), bindersFor(name)), besideFor(name), `${where}${name}.zb`));
  });
  const js = (name, stylesHref) => (minify ? once(`min:${name}${stylesHref ? `:${stylesHref}` : ''}`, () => shrink(compiled(name, stylesHref))) : compiled(name, stylesHref));

  /** What each bare specifier a browser module may import resolves to: the import map's entries. */
  // `runtimeFile`: the runtime's core, `zubra.js` where it and what it imports are one file
  // (`@zubra/runtime`'s `dist/bundled`, what the Node server sends in production), so a page asks
  // for one module where it asked for a dozen, or `core.js` file by file. It has neither
  // zb-await's binder, the slots' nor $define, which the modules this server compiles import
  // from their own entries (`binderEntries`).
  // Each binder's file sits beside the runtime, wherever `imports` points `@zubra/runtime` (a CDN,
  // say), so a page never mixes two copies of it. (The modules import them by address: js().)
  //
  // `runtimeSplit` (`@zubra/runtime/modules`' `split`, from a runtime that has one): the runtime's
  // base is what every page loads (`zubra.js`, or `base.js` file by file), and what only some
  // components use (context, form controls and helpers, event modifiers and helpers, shadow roots,
  // `resource()`) is in files of its own. The modules this server sends take each name from the
  // file that has it (`routed`, below), so a page loads only those its components name. The bare
  // `@zubra/runtime` in the import map is then the whole script API (`core.js`: the base and those
  // files), for a script of the page's own; it is the same modules, so one copy of everything.
  // Not when `imports` says where the runtime is: that address is all this server knows about it,
  // and it is used as it always was.
  //
  // `runtimeBuilt` (experimental; `buildRuntime()` of `@zubra/server/build` makes one): the app's
  // own build of the runtime, one module with only what its components name and what that
  // reaches. It takes the place of the base and every file beside it: each name a served module
  // imports from the runtime, whichever entry or file it named, comes from that one module, and
  // so does the bare `@zubra/runtime`. A name it doesn't have is an error that says to build
  // again, when the module is compiled and not in the browser. The runtime's other files would
  // be a second copy of it (two graphs of signals that don't see each other), so while a built
  // runtime is served they answer with a module that throws and says so.
  //
  // A build may hold the app's components as well (`buildApp()`: `components`, their names, and
  // `scripts` if it took the app's own page scripts too). Then that one module is all a page
  // loads: it is the page's only script and only preload, and a component's own address answers
  // with an import of it. A component it doesn't hold is refused like a name it doesn't have.
  // `sync`: @zubra/sync is in the module too, and these are its store module's exports. That
  // module's own address then answers with them, taken from the app's module, so a script
  // outside it that imports @zubra/sync (or the package's connect.js, served as it is) shares
  // the one store.
  const built = runtimeBuilt && !imports['@zubra/runtime'] ? { file: runtimeBuilt.file, code: runtimeBuilt.code, names: new Set(runtimeBuilt.names), components: runtimeBuilt.components ? new Set(runtimeBuilt.components) : null, scripts: Boolean(runtimeBuilt.scripts), sync: runtimeBuilt.sync ?? null } : null;
  const whole = built?.components ?? null;
  const inWhole = (name) => {
    if (!whole.has(name)) throw new Error(`${where}${name} isn't in the app's built module. Build it again (buildApp()) now that the components have changed`);
    return name;
  };
  const builtMissing = (name, where) => new Error(`${where} imports \`${name}\` from @zubra/runtime, which the built runtime doesn't have. Build it again (buildRuntime()) now that the components have changed, or pass \`keep: ['${name}']\` if a script of your own needs it`);
  const splitting = !built && Boolean(runtimeSplit) && !imports['@zubra/runtime'];
  const baseFile = runtimeFile === 'zubra.js' ? 'zubra.js' : runtimeSplit?.base;
  const runtimeUrl = imports['@zubra/runtime'] ?? `${base}/runtime/${built ? built.file : splitting ? 'core.js' : runtimeFile}`;
  // zb-if's, zb-each's, event modifiers', form controls' and hydration's binders are the core's own, so they
  // come from `@zubra/runtime` like the rest of it. zb-await's and the slots' are files of their own, beside the core: by a path
  // relative to the component's module, so they move with the folder (a static site that serves
  // `/_zubra/` from somewhere else, rewriting only its pages), or by the address `imports` gave.
  const besideFor = (name) => (file) => (imports['@zubra/runtime'] ? runtimeUrl.replace(/[^/]*$/, file) : `${'../'.repeat(name.split('/').length)}runtime/${file}`);
  /**
   * A module written by a compiler from before interface 5 (5.19.0 and earlier: an app that
   * updates this package and keeps its compiler) takes `$element`, or `$define`, from
   * `@zubra/runtime` itself. The core this server maps that to has neither (they are
   * `legacy.js`'s, so a page of current components doesn't load them), and the browser would
   * refuse the whole module: "does not provide an export named '$element'", and no element of
   * the page starts. So that one name is taken from `legacy.js`, beside the core, and the rest
   * of the import stays as it was. Current output names neither, and is returned untouched.
   */
  const older = (name, code) => code.replace(/import\s*\{([^}]*)\}\s*from\s*(["'])@zubra\/runtime\2;?/g, (whole, names, quote) => {
    const all = names.split(',').map((one) => one.trim()).filter(Boolean);
    const legacy = all.filter((one) => /^\$(?:define|element)(?:\s|$)/.test(one));
    if (!legacy.length) return whole;
    if (built) throw new Error(`${where}${name} was compiled by an older Zubra (it asks for ${legacy[0].split(/\s/)[0]}), which a built runtime can't serve: compile it again, or leave out \`runtime\``);
    const rest = all.filter((one) => !legacy.includes(one));
    return `import { ${legacy.join(', ')} } from ${quote}${besideFor(name)('legacy.js')}${quote};${rest.length ? ` import { ${rest.join(', ')} } from ${quote}@zubra/runtime${quote};` : ''}`;
  });
  /**
   * `code` (a module this server sends) with each name it imports from `@zubra/runtime` taken
   * from the file that has it: the base, or the split file `runtimeSplit` names. `beside` gives a
   * runtime file's address from where the module is served. Only `import { … } from`: anything
   * else (`import * as`, `export … from`) keeps the bare specifier, which is the whole API.
   */
  const routed = (code, beside, from = 'a module') => (built ? String(code).replace(/import\s*\{([^}]*)\}\s*from\s*(["'])(@zubra\/runtime(?:\/[\w-]+)?|(?:\.\.\/)+runtime\/[\w.-]+\.js)\2;?/g, (_whole, names, quote) => {
    // (Every entry and file of the runtime: the built module is all of them at once.)
    const list = names.split(',').map((one) => one.trim()).filter(Boolean);
    for (const one of list) if (!built.names.has(one.split(/\s+as\s+/)[0])) throw builtMissing(one.split(/\s+as\s+/)[0], from);
    return `import { ${list.join(', ')} } from ${quote}${beside(built.file)}${quote};`;
  }) : !splitting ? code : String(code).replace(/import\s*\{([^}]*)\}\s*from\s*(["'])@zubra\/runtime\2;?/g, (_whole, names, quote) => {
    const byFile = new Map();
    for (const one of names.split(',').map((one) => one.trim()).filter(Boolean)) {
      const file = runtimeSplit.names[one.split(/\s+as\s+/)[0]] ?? baseFile;
      byFile.set(file, [...(byFile.get(file) ?? []), one]);
    }
    return [...byFile].map(([file, list]) => `import { ${list.join(', ')} } from ${quote}${beside(file)}${quote};`).join(' ');
  }));
  /** A runtime file's address from a module served at `<base>/<folder>/<path>`. */
  const besideAt = (path) => (file) => `${'../'.repeat(path.split('/').length)}runtime/${file}`;
  const bindersFor = (name) => {
    const beside = besideFor(name);
    if (splitting) {
      const own = beside(baseFile);
      return { '@zubra/runtime/when': own, '@zubra/runtime/each': own, '@zubra/runtime/hydrate': own, '@zubra/runtime/parts': own, '@zubra/runtime/modifiers': beside('modifiers.js'), '@zubra/runtime/form': beside('form.js'), '@zubra/runtime/shadow': beside('shadow.js'), '@zubra/runtime/await': beside('await.js'), '@zubra/runtime/slots': beside('slots.js') };
    }
    return { '@zubra/runtime/when': '@zubra/runtime', '@zubra/runtime/each': '@zubra/runtime', '@zubra/runtime/modifiers': '@zubra/runtime', '@zubra/runtime/form': '@zubra/runtime', '@zubra/runtime/hydrate': '@zubra/runtime', '@zubra/runtime/parts': '@zubra/runtime', '@zubra/runtime/shadow': '@zubra/runtime', '@zubra/runtime/await': beside('await.js'), '@zubra/runtime/slots': beside('slots.js') };
  };
  const entry = (file) => `${base}/runtime/${built ? built.file : file}`;
  const mapping = () => ({ '@zubra/runtime': runtimeUrl, '@zubra/runtime/spread': entry('spread.js'), '@zubra/runtime/primitives': entry('primitives.js'), '@zubra/runtime/motion': entry('motion.js'), '@zubra/runtime/track': entry('track.js'), ...syncImports, ...imports });
  /**
   * `inline: false` (a Content-Security-Policy without `'unsafe-inline'`, on a site that can't
   * give each response a nonce): a page gets no import map, so every module is served with its
   * bare imports already resolved, to what the import map would have said.
   */
  const resolved = (code) => (inline ? code : resolveImports(String(code), mapping()));
  const importMap = (options) => (inline ? `<script type="importmap"${nonceAttribute(options)}>${scriptJson({ imports: mapping() })}</script>` : '');
  /**
   * The modules under `base` that the module at `url` imports statically, as URLs. A module this
   * server can't read (`@zubra/sync`, where the host serves it from static assets) imports
   * nothing as far as it knows.
   */
  const importsOf = (url) => once(`imports:${url}`, () => {
    // The runtime's own modules: from its list (`@zubra/runtime/modules`), not from the files,
    // so a page is the same wherever it is built, a host that can't read them included.
    if (url.startsWith(`${base}/runtime/`)) return (runtimeModules[url.slice(`${base}/runtime/`.length)] ?? []).map((name) => `${base}/runtime/${name}`);
    const served = serve(url);
    if (!served || served.status !== 200) return [];
    const map = mapping();
    return staticImports(String(served.body))
      .map((specifier) => resolveSpecifier(specifier, url, map))
      // Ours, and there: text that only looks like an import (in a string) names nothing we serve.
      // (The runtime's modules aren't asked for: the host may serve them from somewhere else.)
      .filter((to) => to !== null && to.startsWith(`${base}/`) && (to.startsWith(`${base}/runtime/`) || (serve(to)?.status ?? 200) === 200));
  });
  /**
   * Every module the page's components load, each once, the components' own first: what they
   * import, and what those import. The browser otherwise finds each level by fetching and
   * parsing the one before (the component, the runtime's entry, the entry's modules, theirs),
   * a round trip per level; told up front, it fetches them all at once.
   */
  const moduleGraph = (urls) => {
    const found = new Set(urls);
    for (const url of found) for (const to of importsOf(url)) found.add(to);
    return [...found];
  };
  const componentUrl = (name) => `${base}/components/${name}.js`;
  /**
   * `bundle`: a page's components as one module, `<base>/b/<names>.<hash>.js`, where each was a
   * request of its own. The set is the components the page ships and the components those
   * import, by name and sorted, so pages that use the same components share a module and any
   * instance of the server can build it from its URL alone; the hash is of the module, so the
   * URL can be cached for good and a deploy that changes a component changes it. The compiler
   * joins them (`command: 'join'`): each module a block, their other imports merged. A set it
   * says must stay apart (two components import different things under one name, say), one whose
   * names don't fit a URL, and a single component are served as before, module by module.
   */
  const JOINED_NAMES = 160; // the most characters of a URL the names may take
  const ASKED = 64; // joined sets built for a URL alone, kept (see `serve`)
  const asked = new Map();
  const joinedKey = (set) => `joined:${set.join('+')}`;
  const componentSet = (names) => {
    const found = [...names];
    for (const name of found) {
      for (const to of importsOf(componentUrl(name))) {
        const other = to.startsWith(`${base}/components/`) && to.endsWith('.js') ? to.slice(`${base}/components/`.length, -3) : null;
        if (other !== null && files.has(other) && !found.includes(other)) found.push(other);
      }
    }
    return found.sort();
  };
  const join = (set) => {
    const id = set.map((name) => name.replaceAll('/', '~')).join('+');
    if (set.length < 2 || id.length > JOINED_NAMES || set.some((name) => !/^[\w./@-]+$/.test(name))) return null;
    // A package's copy of a tag the app has too is served as the app's module (see `serve`).
    if (set.some((name) => fromPackage(name) && owners().shadows.get(name) !== undefined)) return null;
    // The page a joined module is for has its components' CSS in the head (and says so: see
    // `carries`), so a light-DOM component's module needn't have the text as well: it gets
    // the stylesheet's address, which the runtime fetches for an element inside a shadow root.
    // Not where a component of the set has a shadow root of its own, though: a light-DOM
    // component rendered inside it would lose its styles until the fetch came back.
    const linked = !set.some((name) => describe(name).shadow);
    const response = request({ command: 'join', at: 'b/joined.js', modules: set.map((name) => ({ path: `components/${name}.js`, code: String(compiled(name, linked ? `${base}/components/${name}.css` : undefined)) })) });
    if (!response.ok) {
      if (!response.apart) throw new Error(`@zubra/server: joining ${set.join(', ')}: ${response.error}`);
      warn(`@zubra/server: ${set.join(', ')} are served as separate modules, not as one: ${response.error}`);
      return null;
    }
    const body = shrink(response.output);
    return { url: `${base}/b/${id}.${hashOf(body)}.js`, body };
  };
  /** The one module for the page's shipped components (`{ url, body }`), or null: serve each. */
  const joined = (names) => {
    if (!bundle || !names.length) return null;
    const set = componentSet(names);
    return once(joinedKey(set), () => join(set));
  };
  /** The modules a page's script loads itself: its components', or the one they are joined as. */
  const entries = (names) => {
    // (The app's one module, for a page with a component of its own or where the module has the
    // app's page scripts.)
    if (whole) return componentSet(names).map(inWhole).length || built.scripts ? [`${base}/runtime/${built.file}`] : [];
    const one = joined(names);
    return one ? [one.url] : names.map(componentUrl);
  };
  const preloads = (names, options) => (preload ? moduleGraph(entries(shipped(names))).map((url) => `<link rel="modulepreload" href="${escapeAttribute(url)}"${nonceAttribute(options)}>`).join('\n') : '');
  // `bundle`: whose CSS a `<style>` or stylesheet link has, by tag (the components named and
  // the ones they import: a component's CSS comes with its children's). A joined module's
  // light-DOM components read it to know the page has their CSS (`stylesHref`).
  const carries = (names) => (bundle ? `="${escapeAttribute(componentSet(names).map((name) => describe(name).tag).join(' '))}"` : '');
  const head = (names, options) => {
    // A component that needs a package that isn't installed fails here, while the page is built,
    // with the reason, rather than later in the browser as an unresolved import.
    for (const name of names) js(name);
    const links = preloads(names, options);
    // Without inline elements: a stylesheet link per component that has CSS, and no import map.
    if (!inline) return [...names.filter((name) => css(name)).map((name) => `<link rel="stylesheet" href="${escapeAttribute(`${base}/components/${name}.css`)}" data-zb-components${carries([name])}>`), ...(links ? [links] : [])].join('\n');
    const styles = names.map(css).join('\n');
    // The preload links come after the import map: a module fetched before it couldn't be one the map names.
    return `${styles ? `<style data-zb-components${carries(names)}${nonceAttribute(options)}>${styles}</style>\n` : ''}${importMap(options)}${links ? `\n${links}` : ''}`;
  };
  // `clientModules: 'needed'`: a component whose server HTML is complete on its own (the
  // compiler's `client` list is empty: no state, handlers, hooks or values computed in the
  // browser, in it or the components it uses) gets no module. For pages that never change
  // those components' props from script.
  const shipped = (names) => (clientModules === 'needed' ? names.filter((name) => (describe(name).client ?? ['unknown']).length > 0) : names);
  const scripts = (all, async = false, options) => {
    const urls = entries(shipped(all));
    if (!inline) return urls.map((url) => `<script type="module"${async ? ' async' : ''} src="${escapeAttribute(url)}"></script>`).join('');
    return urls.length ? `<script type="module"${async ? ' async' : ''}${nonceAttribute(options)}>${urls.map((url) => `import '${url}';`).join(' ')}</script>` : '';
  };

  /** What a request for `pathname` gets: `{ status, type, body }`, or null if it isn't ours. */
  function serve(pathname) {
    if (!pathname.startsWith(`${base}/`)) return null;
    // `reload`: the script a page gets (its event stream is the server's own to answer).
    if (reload && pathname === `${base}/reload.js`) return { status: 200, type: TYPES['.js'], body: `(${RELOAD_IN_BROWSER})(${scriptJson(base)})` };
    // `reload`: what each named component's module is now, for the page to tell which changed.
    if (reload && pathname.startsWith(`${base}/reload/versions/`)) return { status: 200, type: 'application/json', body: JSON.stringify(versions(pathname.slice(`${base}/reload/versions/`.length))) };
    let rest;
    // A malformed escape (`%E0%A4%A`) is the client's mistake: a 400, never a throw that
    // takes down a server written as `if (zubra.handle(req, res)) return;`.
    try { rest = decodeURIComponent(pathname.slice(base.length + 1)); } catch { return { status: 400, type: 'text/plain', body: 'Bad request' }; }
    // A component's stylesheet, for the `<link>` a page without inline elements has.
    // (And, with `bundle`, for a light-DOM component of a joined module inside a shadow root.)
    if ((!inline || bundle) && rest.startsWith('components/') && rest.endsWith('.css')) {
      const name = rest.slice('components/'.length, -4);
      return files.has(name) ? { status: 200, type: TYPES['.css'], body: css(name) } : { status: 404, type: 'text/plain', body: 'Not found' };
    }
    // A page's components as one module: built from the names in its URL (any instance of
    // the server can), and there only under the hash of what they make now.
    if (bundle && rest.startsWith('b/') && rest.endsWith('.js')) {
      const set = rest.slice('b/'.length, rest.lastIndexOf('.', rest.length - 4)).split('+').map((name) => name.replaceAll('~', '/'));
      const known = set.every((name) => files.has(name)) && set.join('+') === componentSet(set).join('+');
      const key = joinedKey(set);
      // A set this server's pages use is in `memo`. One only a URL asked for (any instance can
      // build any set from its URL) is built to answer and kept among the most recent `ASKED`,
      // whatever the hash said: there are as many sets as subsets of the components, so asking
      // for one after another neither grows memory without end nor joins the same set twice.
      let one = null;
      if (known && memo.has(key)) one = memo.get(key);
      else if (known) {
        one = asked.has(key) ? asked.get(key) : join(set);
        asked.delete(key);
        asked.set(key, one);
        if (asked.size > ASKED) asked.delete(asked.keys().next().value);
      }
      if (!one || one.url !== `${base}/${rest}`) return { status: 404, type: 'text/plain', body: 'Not found' };
      return { status: 200, type: TYPES['.js'], body: one.body, immutable: true };
    }
    // A component the app's one module holds: its own address is that module, so nothing
    // defines the element twice.
    if (whole && rest.startsWith('components/') && rest.endsWith('.js') && whole.has(rest.slice('components/'.length, -3))) {
      return { status: 200, type: TYPES['.js'], body: `import '${besideFor(rest.slice('components/'.length, -3))(built.file)}';\n` };
    }
    if (rest.startsWith('components/') && rest.endsWith('.js')) {
      const name = rest.slice('components/'.length, -3);
      // A plain module a component imports (`./theme.js`): the host serves it from the
      // components folder, as it is.
      // Only one a browser module imports, though: the folder also holds what `'use server'`
      // functions import (keys, database code), and those stay on the server.
      if (!files.has(name)) {
        const path = rest.slice('components/'.length);
        const module = browserModules().has(path) && localModule(path);
        if (!module) return { status: 404, type: 'text/plain', body: 'Not found' };
        const body = routed(module.body, besideAt(path), `${where}${path}`);
        return { ...module, body: inline ? body : resolved(body) };
      }
      // A package's copy of a tag the app has too: the module is the app's, so the browser
      // defines the tag once, however the package's components import it.
      const app = fromPackage(name) ? owners().shadows.get(name) : undefined;
      if (app !== undefined) {
        const url = JSON.stringify(`${base}/components/${app}.js`);
        return { status: 200, type: TYPES['.js'], body: `export * from ${url};\nexport { default } from ${url};\n` };
      }
      // `reload`: a component's module says, before it defines its element, that the page swaps
      // new versions of components in (the runtime's development build keeps track of the live
      // elements only then). On the first line, so line numbers in errors stay the compiler's.
      return { status: 200, type: TYPES['.js'], body: reload ? `globalThis.__ZUBRA_HOT__ = true; ${js(name)}` : js(name) };
    }
    if (built && rest.startsWith('runtime/') && rest.endsWith('.js')) {
      const file = rest.slice('runtime/'.length);
      if (file === built.file) return { status: 200, type: TYPES['.js'], body: built.code, immutable: true };
      // (remark.js imports nothing: the built module loads it when server markup needs repair.)
      if (file !== 'remark.js') return { status: 200, type: TYPES['.js'], body: `throw new Error(${JSON.stringify(`@zubra/server: this app serves a built runtime (${built.file}), and something asked for the runtime's own ${file}, which would be a second copy of it. A script that imports the runtime should use the name @zubra/runtime; a component compiled elsewhere needs \`runtime\` left out`)});\n` };
    }
    if (built?.sync && rest === 'sync/index.js') return { status: 200, type: TYPES['.js'], body: `import { $zubraSync } from '../runtime/${built.file}';\nexport const { ${built.sync.join(', ')} } = $zubraSync;\n` };
    // The runtime and @zubra/sync are the host's to serve (from disk on Node, from static assets elsewhere).
    const asset = assets(rest);
    // The runtime's and @zubra/sync's own modules import each other by name too.
    if (!asset || asset.status !== 200 || !rest.endsWith('.js')) return asset;
    // @zubra/sync's modules take what they use of the runtime from its files, as components do.
    const body = rest.startsWith('sync/') ? routed(asset.body, besideAt(rest.slice('sync/'.length)), `@zubra/sync's ${rest.slice('sync/'.length)}`) : asset.body;
    return inline ? (body === asset.body ? asset : { ...asset, body }) : { ...asset, body: resolved(body) };
  }
  // (With `changed`, a module may differ on the next request: the browser asks each time.)
  const cacheControl = cache && !changed ? 'public, max-age=3600' : 'no-cache';
  /** The `cache-control` for what `serve` answered: a URL with its content's hash in it is for good. */
  // Only a 200 is cached: a 404 cached before a deploy would outlast it by an hour.
  const cacheControlOf = (served) => (served.status !== 200 ? 'no-cache' : cache && served.immutable ? 'public, max-age=31536000, immutable' : cacheControl);

  /** Fetch-style servers: a Response for our paths, or null. */
  async function fetchHandler(request) {
    const served = serve(new URL(request.url).pathname);
    if (!served) return null;
    return new Response(served.body, { status: served.status, headers: { 'content-type': served.type, 'cache-control': cacheControlOf(served) } });
  }

  // `reload` (development): a page asks for a script that keeps an event stream to the server
  // open and reloads the page when the server is back after going away, which is what a restart
  // on a saved file looks like from the browser. A file of its own, so no policy has to allow it inline.
  //
  // When the server is back, the script asks what each of the page's components is now (their
  // names are on the script, `data-components`: the ones the page loads and those they import).
  // Where only components changed, it imports the new versions, which the runtime swaps into the
  // live elements, keeping their state, as a bundler's hot updates do; anything else (the
  // server's own code, a component whose props or events changed, one that doesn't compile)
  // reloads the page.
  const reloading = (options, used) => {
    if (!reload) return '';
    const names = !built && !bundle ? componentSet(shipped(used)) : [];
    return `<script src="${escapeAttribute(`${base}/reload.js`)}"${names.length ? ` data-components="${escapeAttribute(names.join(' '))}"` : ''} async${nonceAttribute(options)}></script>`;
  };
  /** `reload`: `{ name: version }` for the `+`-joined names (`/` written `~`); a component that doesn't compile is `"error"` (its import fails, and the page reloads to the error). */
  const versions = (list) => {
    const out = {};
    for (const name of list.split('+').map((one) => one.replaceAll('~', '/'))) {
      if (!files.has(name)) continue;
      try { out[name] = fnv(js(name)); } catch { out[name] = 'error'; }
    }
    return out;
  };

  /**
   * The answer to a request that failed (`{ status: 500, type, body }`), for an app's own
   * `catch`. In development, an HTML page with what went wrong: the error's message (a
   * component's comes with its file, line, a caret and often a fix) and, for an error with a
   * stack, where it was thrown; with `reload`, it carries the script, so it goes away when the fix
   * is saved. In production, "Something went wrong" and nothing more: an error's message can hold
   * what a visitor shouldn't see (a query, a path, a host). `options.nonce`: the page's nonce, for
   * a policy that needs one on the script.
   */
  function errorPage(error, options = {}) {
    if (production) return { status: 500, type: 'text/plain; charset=utf-8', body: 'Something went wrong' };
    const message = error instanceof Error ? error.message : String(error);
    // Where it was thrown: the stack's frames, without its first line (the message again). Not for
    // a component's compile error, whose frames are this server's own and say nothing about it.
    const frames = error instanceof Error && !error[COMPILE_ERROR] && typeof error.stack === 'string' ? error.stack.split('\n').filter((line) => /^\s+at /.test(line)).join('\n') : '';
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Error</title></head><body><pre>${escapeText(message)}</pre>${frames ? `<pre>${escapeText(frames)}</pre>` : ''}${reloading(options, [])}</body></html>`;
    return { status: 500, type: 'text/html; charset=utf-8', body };
  }

  /** One page: render components into it, then `finish()` it (or use `head()` and `scripts()`). */
  function page(options = {}) {
    nonceAttribute(options); // a nonce that can't be one fails here, not in the middle of a page
    if (options.streamTimeout !== undefined) checkTimeout(options.streamTimeout);
    const limit = options.streamTimeout ?? streamTimeout;
    const used = [];
    let renders = 0;
    const provided = {};
    const use = (name) => {
      if (!used.includes(name)) used.push(name);
    };
    // Streaming (3.3): a prop given as a promise renders as pending (its `zb-await` shows its
    // pending content, in an empty region), and `stream()` sends the resolved region after the
    // page, with the value, for the element to hydrate.
    const pendingRenders = [];
    let streamed = 0;
    return {
      used,
      /**
       * Provide a context's value to every component this page renders from now on, as a
       * component above them would: `page.provide({ module: './theme.js', export: 'theme' },
       * 'dark')`, where `module` is the file that exports `createContext()`, relative to the
       * components folder. Components render with it, and their elements start from it. To
       * change it in the browser, put the page in a `<zb-context>` with the same value.
       */
      provide(context, value) {
        if (!context || typeof context.module !== 'string' || typeof context.export !== 'string') {
          throw new Error("@zubra/server: page.provide() takes { module: './theme.js', export: 'theme' } and a value");
        }
        provided[contextKey(context)] = value;
        return this;
      },
      render(name, props = {}, slots) {
        const key = nameOf(name) ?? name;
        renders += 1;
        const idPrefix = renders === 1 ? '' : `r${renders}-`;
        const promises = Object.entries(props).filter(([, value]) => value && typeof value.then === 'function');
        // A component is the page's once it has rendered: one that failed (a name that isn't a
        // component's) would otherwise fail again in head() and finish().
        if (!promises.length) {
          const html = render(key, props, slots, [], idPrefix, provided);
          use(key);
          return html;
        }
        const given = Object.fromEntries(Object.entries(props).filter(([, value]) => !(value && typeof value.then === 'function')));
        const names = promises.map(([name]) => name);
        // A promise prop is handed over by inline scripts, which a page can't do without.
        if (!inline && options.nonce === undefined) throw new Error('@zubra/server: with inline: false, a prop given as a promise needs a nonce for the scripts that stream its value: page({ nonce })');
        const id = String(streamed++);
        const shell = withStreamId(render(key, given, slots, names, idPrefix, provided), id);
        use(key);
        const entry = { key, id, given, slots, promises: new Map(promises), shell, count: 0, idPrefix };
        // Each pending region is a named range (`<?start name>`…`<?end>`) that a streamed
        // `<template for>` replaces (out-of-order streaming).
        entry.names = pendingRegions(shell).map(() => `zb-${id}-${entry.count++}`);
        pendingRenders.push(entry);
        // Until the values arrive, the element (should it start first) holds a promise for
        // each, set before it upgrades, so its `zb-await` shows the pending content.
        return `${named(shell, entry.names)}<script${nonceAttribute(options)}>(${HOLD_IN_BROWSER})(${scriptJson(id)},${scriptJson(names)})</script>`;
      },
      /** Whether a rendered component is waiting on a promise prop (then `stream()`, not `finish()`). */
      get pending() {
        return pendingRenders.length > 0;
      },
      /**
       * The page as a stream: `finish(html)` first, then, as each promise prop settles, the
       * resolved regions, each in a `<template for>` (which the browser puts in place itself
       * where it streams out of order), and a short inline script that hands the element the
       * value, and puts the regions in place where the browser didn't.
       * `streamResponse(html)` is a web `Response`; `chunks(html)` the strings it is made of
       * (Node's `stream(html)` turns them into a Readable).
       */
      chunks,
      streamResponse(html, init = {}) {
        return new Response(webStream(chunks(html)), { ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers } });
      },
      /** The components' CSS and the import map, for the page's `<head>`. */
      head: () => head(used, options),
      /** The module script that makes the components interactive, for the end of `<body>`. */
      scripts: () => scripts(used, false, options) + reloading(options, used),
      /** A whole page with the head and scripts put in (before `</head>` and `</body>`). */
      finish(html) {
        strangers(html);
        return insertBefore(insertBefore(html, '</head>', head(used, options)), '</body>', scripts(used, false, options) + reloading(options, used));
      },
    };

    /**
     * `checkPages` (development): a component's tag in the page that this page object didn't
     * render, and that none it rendered imports. What `finish()` adds is for the components this
     * object rendered, so that one gets no CSS and no module: it shows the server's HTML and
     * never starts, with nothing in the console. The usual causes are a second `zubra.page()`
     * (one to render, another to finish) and a component whose template uses a sibling's tag
     * without importing it, so the warning says which tag and what to do for each. A page that
     * loads the module itself (its URL is in the HTML) is left alone. Said once per tag.
     */
    function strangers(html) {
      if (!checkPages) return;
      let tags;
      try {
        tags = byTag();
      } catch {
        return; // (two files with one tag: an error for whoever asks for that tag, not for this page)
      }
      let known = null;
      for (const { tag } of hostTags(html, tags)) {
        const name = tags.get(tag);
        known ??= new Set(componentSet(used));
        if (known.has(name) || html.includes(componentUrl(name))) continue;
        const message = `@zubra/server: the page has <${tag}>, but nothing this page object rendered loads it, so its CSS and module aren't in the page and the element won't start in the browser. The two usual causes: it was rendered by another page object or by zubra.render() (render and finish with one object per request: const page = zubra.page(); page.render('${tag}', props); page.finish(html)), or a component's template uses <${tag}> without importing it (add its import to that component's script: import './${name.split('/').pop()}.zb'; without it the server leaves the tag empty as well).`;
        warnOnce(message);
      }
    }

    async function* chunks(html) {
      strangers(html);
      // The shell: as the ordinary page, but with the module script `async`, so the elements
      // start as soon as it has loaded instead of when the stream ends (a module script is
      // deferred until the document is complete). A region that arrives after an element has
      // started reaches it as a property change.
      yield insertBefore(insertBefore(html, '</head>', head(used, options)), '</body>', scripts(used, true, options));
      // Each value within the page's `streamTimeout`, or its region is rejected, so the response ends.
      const timers = [];
      const within = (promise, entry, name) => (limit > 0 && limit !== Infinity
        ? Promise.race([promise, new Promise((_, reject) => {
          timers.push(setTimeout(() => reject(new Error(`@zubra/server: <${tagOf(entry.key)}>'s prop ${name} didn't settle within ${limit} ms (streamTimeout)`)), limit));
        })])
        : promise);
      const waiting = pendingRenders.splice(0).flatMap((entry) =>
        [...entry.promises].map(([name, promise]) => within(promise, entry, name).then(
          (value) => ({ entry, name, value }),
          (error) => ({ entry, name, error: rejected(error, entry.key, name) }),
        )));
      try {
        yield* settled(waiting);
      } finally {
        for (const timer of timers) clearTimeout(timer);
      }
    }

    /**
     * What a rejected prop sends the browser: in production, "Internal error" (a database's
     * error can carry hosts, users and queries); in development, its message. Either way the
     * error goes to `onError(error, { component, prop })`, or to the log with its stack.
     */
    function rejected(error, key, name) {
      const component = tagOf(key);
      try {
        if (onError) onError(error, { component, prop: name });
        else warn(`@zubra/server: <${component}>'s prop ${name} was rejected: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      } catch (thrown) {
        warn(`@zubra/server: onError threw: ${thrown instanceof Error ? thrown.stack ?? thrown.message : String(thrown)}`);
      }
      if (production) return 'Internal error';
      return error instanceof Error ? error.message : String(error);
    }

    async function* settled(waiting) {
      // In the order they settle.
      const open = new Set(waiting.map((promise) => {
        const tagged = promise.then((result) => ({ result, tagged }));
        return tagged;
      }));
      while (open.size) {
        const { result, tagged } = await Promise.race(open);
        open.delete(tagged);
        const { entry, name, value, error } = result;
        if (error !== undefined) {
          yield swapScript(entry.id, null, { [name]: { error } }, options);
          continue;
        }
        entry.given[name] = value;
        entry.promises.delete(name);
        const resolved = withStreamId(render(entry.key, entry.given, entry.slots, [...entry.promises.keys()], entry.idPrefix, provided), entry.id);
        const swaps = new Map(regionSwaps(entry.shell, resolved).map((swap) => [swap.index, swap.html]));
        entry.shell = resolved;
        // The regions still pending keep their names; one that resolved is replaced, along with
        // its name, by the pending regions inside it.
        const regions = [];
        entry.names = entry.names.flatMap((region, index) => {
          if (!swaps.has(index)) return [region];
          const html = swaps.get(index);
          const inner = pendingRegions(html).map(() => `zb-${entry.id}-${entry.count++}`);
          regions.push({ name: region, html: named(html, inner) });
          return inner;
        });
        yield swapScript(entry.id, regions, { [name]: { value } }, options);
      }
    }
  }

  /**
   * Shadow roots for a framework's HTML: each shadow-DOM component's host gets its
   * server-rendered template as a declarative shadow root (read from the host's `zb-props`
   * JSON, or its attributes), so it shows before JavaScript; the browser attaches it while
   * parsing, before any framework hydrates. Form-associated components with a `name` also get a
   * hidden input with their value, so the form submits without JavaScript (the element removes
   * it when it starts). Light-DOM components are left alone unless `lightDom: true` (3.3): then
   * an empty light-DOM host gets its rendered children, for frameworks that leave nodes they
   * didn't render alone while hydrating (Solid; React and Vue through their wrappers do this
   * themselves). Not for Svelte, which claims every node.
   */
  /** The components by tag (shadow-DOM ones, or all with `lightDom`), and a pattern for their hosts' start tags. */
  function shadowHosts(lightDom = false) {
    const shadowTags = new Map();
    for (const name of files.keys()) {
      const info = describe(name);
      if (info.shadow || lightDom) shadowTags.set(info.tag, { name, info });
    }
    // Where hosts are found: `hostTags`, which reads tags as the browser does, not a pattern.
    const pattern = shadowTags.size ? { hosts: (html, state) => hostTags(html, shadowTags, state) } : null;
    return { shadowTags, pattern };
  }

  // `hosts` counts the hosts given content so far, for their id prefixes; a stream shares one
  // across its chunks.
  // `state` carries what one piece of a streamed page ended inside (a comment, a script) to the
  // next piece; a stream shares one, as it does `hosts`.
  function injectShadowRoots(html, { forms = true, lightDom = false, hosts = { count: 0 }, state = {} } = {}) {
    const { shadowTags, pattern } = shadowHosts(lightDom);
    if (!pattern) return html;
    let out = '';
    let last = 0;
    for (const found of pattern.hosts(html, state)) {
      const { end, tag, attributes } = found;
      const { name, info } = shadowTags.get(tag);
      // Already has one (rendered by zubra, or a second pass); a light-DOM host must be empty.
      if (info.shadow ? /^\s*<template\s[^>]*shadowroot/i.test(html.slice(end, end + 200)) : !new RegExp(`^\\s*</${tag}>`, 'i').test(html.slice(end, end + 200))) continue;
      const props = propsFrom(attributes, info);
      let rendered;
      try {
        // Each host is its own render: its own prefix keeps their ids apart.
        rendered = render(name, props, {}, [], `h${++hosts.count}-`);
      } catch {
        continue; // leave it to the browser rather than break the page
      }
      const template = info.shadow ? shadowTemplate(rendered) : lightContent(rendered, tag);
      if (!template) continue;
      out += html.slice(last, end) + template + (forms ? fallbackInput(attributes, info, props) : '');
      last = end;
    }
    return out + html.slice(last);
  }


  return {
    files,
    pathOf,
    serve,
    cacheControl,
    cacheControlOf,
    /** The joined modules made so far (`{ url, body }`), for a static site's files. */
    joinedModules: () => [...memo].filter(([key, value]) => key.startsWith('joined:') && value).map(([, value]) => value),
    shadowHosts,
    injectShadowRoots,
    page,
    errorPage,
    importMap,
    fetch: fetchHandler,
    module: (name) => js(nameOf(name) ?? name),
    names: [...files.keys()],
    describe: (name) => describe(nameOf(name) ?? name),
    render: (name, props, slots) => render(nameOf(name) ?? name, props, slots),
    css: (name) => css(nameOf(name) ?? name),
    resolveImports: (code) => resolved(code),
    head: (names = [...files.keys()], options) => head(names, options),
    scripts: (names = [...files.keys()], options) => scripts(names, false, options),
  };
}

/** How many single-character edits turn `a` into `b`. */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** An async iterable of strings as a web ReadableStream of UTF-8 bytes. */
function webStream(chunks) {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function insertBefore(html, marker, text) {
  if (!text) return html;
  const at = html.lastIndexOf(marker);
  return at < 0 ? html + text : html.slice(0, at) + text + html.slice(at);
}

// ---- reading a host tag ---------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"' };
const decode = (text) => text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
  if (ENTITIES[name.toLowerCase()]) return ENTITIES[name.toLowerCase()];
  if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
  return whole;
});

/** An opening tag's attributes: `{ name: value }` (a bare attribute is `""`). */
export function parseAttributes(text) {
  const attributes = {};
  const pattern = /([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of text.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** The props a host tag carries: `zb-props` JSON first, then each prop's attribute by its type. */
// Elements whose content is text to the browser, not tags: a host's name in them is not a host.
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

/** Where a tag whose attributes start at `at` ends (after its `>`), or -1 and the open quote. */
function endOfTag(html, at, quote = null) {
  for (let i = at; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return { end: i + 1, quote: null };
  }
  return { end: -1, quote };
}

/**
 * Each start tag of a host (`tags`' keys) in `html` where the browser would see one: not in a
 * comment, in a script's or a textarea's text, or inside another tag's quoted attribute value
 * (`<div title="<x-host>">`, which Solid and Svelte write unescaped). Injecting into any of those
 * would close the value or the script around it with the template's own quotes and tags. `state`
 * is what the last piece ended inside, for a streamed page, and is left saying what this one did.
 */
export function* hostTags(html, tags, state = {}) {
  const name = /<(\/?)([A-Za-z][^\s/>]*)/y;
  let i = 0;
  while (i < html.length) {
    const inside = state.inside;
    if (inside === 'comment') {
      // The `-->` may have started in the last piece: `--` or `-` it ended with count here.
      const dashes = state.dashes ?? 0;
      state.dashes = 0;
      let end;
      if (dashes >= 2 && html[i] === '>') end = i - 2;
      else if (dashes >= 1 && html.startsWith('->', i)) end = i - 1;
      else {
        end = html.indexOf('-->', i);
        if (end < 0) {
          const rest = html.slice(i);
          const trailing = rest.length - rest.replace(/-+$/, '').length;
          state.dashes = Math.min(trailing === rest.length ? dashes + trailing : trailing, 2);
          return;
        }
      }
      i = end + 3;
      state.inside = null;
      continue;
    }
    if (inside?.raw) {
      const close = new RegExp(`</${inside.raw}[\\s/>]`, 'ig');
      close.lastIndex = i;
      const found = close.exec(html);
      if (!found) return;
      i = found.index;
      state.inside = null;
      continue;
    }
    if (inside?.tag) {
      const { end, quote } = endOfTag(html, i, inside.quote);
      if (end < 0) return void (state.inside = { ...inside, quote });
      i = end;
      state.inside = inside.raw_after ? { raw: inside.raw_after } : null;
      continue;
    }
    const lt = html.indexOf('<', i);
    if (lt < 0) return;
    if (html.startsWith('<!--', lt)) {
      state.inside = 'comment';
      i = lt + 4;
      continue;
    }
    name.lastIndex = lt;
    const tag = name.exec(html);
    if (!tag) {
      // `<!doctype …>`, `<?…>`, or a `<` that starts nothing.
      if (html[lt + 1] === '!' || html[lt + 1] === '?') {
        const end = html.indexOf('>', lt);
        if (end < 0) return;
        i = end + 1;
      } else i = lt + 1;
      continue;
    }
    const closing = tag[1] === '/';
    const lower = tag[2].toLowerCase();
    const from = lt + tag[0].length;
    const raw = !closing && RAW_TEXT.has(lower) ? lower : null;
    const { end, quote } = endOfTag(html, from);
    if (end < 0) return void (state.inside = { tag: true, quote, raw_after: raw });
    if (!closing && tags.has(lower)) yield { index: lt, end, tag: lower, attributes: html.slice(from, end - 1) };
    if (raw) state.inside = { raw };
    i = end;
  }
}

export function propsFrom(attributeText, info) {
  const attributes = parseAttributes(attributeText);
  let props = {};
  if (attributes['zb-props']) {
    try {
      props = JSON.parse(attributes['zb-props']);
    } catch {}
  }
  for (const prop of info.props) {
    if (prop.name in props || !(prop.attribute in attributes)) continue;
    const raw = attributes[prop.attribute];
    const kind = Array.isArray(prop.default) || (prop.default && typeof prop.default === 'object') ? 'json' : prop.type;
    if (kind === 'number') {
      const number = Number(raw);
      if (raw.trim() !== '' && Number.isFinite(number)) props[prop.name] = number;
    } else if (kind === 'boolean') {
      props[prop.name] = raw !== 'false';
    } else if (kind === 'json' || /\[\]$|^\{/.test(prop.type)) {
      if (raw === '[object Object]') continue; // Svelte's SSR: the real value comes later
      try {
        props[prop.name] = JSON.parse(raw);
      } catch {}
    } else {
      props[prop.name] = raw;
    }
  }
  return props;
}

/** The `<template shadowrootmode>…</template>` at the start of a rendered host's content. */
function shadowTemplate(rendered) {
  const start = rendered.search(/<template\s[^>]*shadowrootmode/i);
  if (start < 0) return null;
  const tags = /<template\b[^>]*>|<\/template>/gi;
  tags.lastIndex = start;
  let depth = 0;
  for (const match of rendered.matchAll(tags)) {
    if (match.index < start) continue;
    depth += match[0][1] === '/' ? -1 : 1;
    if (depth === 0) return rendered.slice(start, match.index + match[0].length);
  }
  return null;
}

/** The host's start tag with `data-zb-stream="<id>"`, so the stream's scripts can find it. */
function withStreamId(html, id) {
  return html.replace(/^(\s*<[a-z][\w.-]*)/, `$1 data-zb-stream="${id}"`);
}

/**
 * The pending regions of `shell` that `resolved` has rendered: `[{ index, html }]`, where
 * `index` counts the shell's top-level `<?zb [??>` regions in order and `html` is the resolved
 * region (markers included). The two renders differ only inside those regions (and the host's
 * start tag, which is compared past).
 */
function regionSwaps(shell, resolved) {
  const skipTag = (html) => html.match(/^\s*<[a-z][\w.-]*(?:\s[^>]*)?>/)?.[0].length ?? 0;
  let a = skipTag(shell);
  let b = skipTag(resolved);
  const swaps = [];
  let index = 0;
  const PENDING = '<?zb [??>';
  const regionEnd = (html, start) => {
    // From the region's opening marker to its matching `<?zb ]?>`.
    let depth = 0;
    for (const match of html.slice(start).matchAll(/<\?zb \[[?!]?\?>|<\?zb \]\?>/g)) {
      depth += match[0] === '<?zb ]?>' ? -1 : 1;
      if (depth === 0) return start + match.index + match[0].length;
    }
    return html.length;
  };
  while (a < shell.length && b < resolved.length) {
    if (shell.startsWith(PENDING, a)) {
      const endA = regionEnd(shell, a);
      const endB = regionEnd(resolved, b);
      const region = resolved.slice(b, endB);
      if (!region.startsWith(PENDING)) swaps.push({ index, html: region });
      index++;
      a = endA;
      b = endB;
      continue;
    }
    if (shell[a] !== resolved[b]) break; // not a difference this function understands
    a++;
    b++;
  }
  return swaps;
}

/**
 * The top-level pending regions of `html` (`<?zb [??>` to its `<?zb ]?>`, not inside another
 * pending region), as `[start, end]` offsets: the ones `regionSwaps` counts.
 */
function pendingRegions(html) {
  const found = [];
  let depth = 0;
  let start = -1;
  let outer = 0;
  for (const match of html.matchAll(/<\?zb (\[[?!]?|\])\?>/g)) {
    if (match[1] === ']') {
      depth--;
      if (start >= 0 && depth === outer) {
        found.push([start, match.index + match[0].length]);
        start = -1;
      }
      continue;
    }
    if (match[1] === '[?' && start < 0) {
      start = match.index;
      outer = depth;
    }
    depth++;
  }
  return found;
}

/** `html` with its top-level pending regions in named ranges, for `<template for>`. */
function named(html, names) {
  let out = html;
  pendingRegions(html).reverse().forEach(([start, end], i, all) => {
    const name = names[all.length - 1 - i];
    out = `${out.slice(0, start)}<?start name="${name}"?>${out.slice(start, end)}<?end?>${out.slice(end)}`;
  });
  return out;
}

/**
 * JSON for inside an inline `<script>`: `<` is written `\u003c`, so no value can close the script
 * (`</script>`) or open a comment (`<!--`), and U+2028/U+2029 are escaped for older parsers.
 * The script reads the same values.
 */
export function scriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** The chunk for one settled promise: each resolved region in a `<template for>`, and the script. */
function swapScript(id, regions, values, options) {
  const templates = (regions ?? []).map((region) => `<template for="${region.name}">${region.html}</template>`).join('');
  const script = `<script${nonceAttribute(options)}>(${SWAP_IN_BROWSER})(${scriptJson(id)},${scriptJson(values)})</script>`;
  return `${templates}${script}\n`;
}

// The two scripts below run in the browser, inlined into the page. They are kept as text, not as
// functions stringified with toString(): a bundler rewrites a function's body for the server it
// builds (esbuild's keep-names, which Wrangler turns on, wraps `var kind = function…` in a
// `__name()` helper that exists only in the bundle), and the page would then throw.
//
// Runs in the browser, inlined, right after a streamed host: a promise per pending prop, as a
// property the element captures when it upgrades, resolved by the swap script later.
// `reload`: the stream opens, is lost when the server stops, and the browser asks again by
// itself; when it opens a second time the server is back, with whatever was saved. Then the
// components that changed are imported again (`?v=` their new version), and the runtime swaps
// each into its live elements; anything else that changed, or a swap the runtime refuses (the
// component's props, events, shadow or form setting changed), reloads the page.
const RELOAD_IN_BROWSER = String.raw`function (base) {
  var script = document.currentScript;
  var names = script && script.getAttribute('data-components') ? script.getAttribute('data-components').split(' ') : [];
  var lost = false;
  var known = null;
  var ask = function () {
    if (!names.length) return Promise.resolve(null);
    var list = names.map(function (name) { return name.split('/').join('~'); }).join('+');
    return fetch(base + '/reload/versions/' + list, { cache: 'no-store' }).then(function (answer) { return answer.ok ? answer.json() : null; }, function () { return null; });
  };
  ask().then(function (now) { known = now; });
  var swap = function (now) {
    var changed = known && now ? names.filter(function (name) { return now[name] !== known[name]; }) : [];
    if (!changed.length) return location.reload();
    Promise.all(changed.map(function (name) { return import(base + '/components/' + name + '.js?v=' + now[name]); })).then(function (modules) {
      if (modules.some(function (module) { return !module.default || module.default.hotReloaded !== true; })) location.reload();
      else known = now;
    }, function () { location.reload(); });
  };
  var stream = new EventSource(base + '/reload');
  stream.onerror = function () { lost = true; };
  stream.onopen = function () { if (lost) { lost = false; ask().then(swap); } };
}`;

/** A short version of `text` (FNV-1a), to tell one module from the next. */
function fnv(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

const HOLD_IN_BROWSER = String.raw`function (id, names) {
  var host = document.querySelector('[data-zb-stream="' + id + '"]');
  var held = (window.__zubraStream = window.__zubraStream || {});
  for (var i = 0; i < names.length; i++) {
    (function (name) {
      host[name] = new Promise(function (resolve, reject) { held[id + ':' + name] = { resolve: resolve, reject: reject }; });
    })(names[i]);
  }
}`;

// Runs in the browser, inlined: hand the element the values (as properties, captured when it
// upgrades), and, before it starts, put the resolved regions in place where the browser didn't:
// browsers without out-of-order streaming leave each `<template for>` as an element, and those
// with it don't reach into a shadow root. Once the element has started it renders the regions
// itself (it removed their names, so the browser has nothing to replace).
const SWAP_IN_BROWSER = String.raw`function (id, values) {
  var host = document.querySelector('[data-zb-stream="' + id + '"]');
  var script = document.currentScript;
  var templates = [];
  for (var node = script && script.previousElementSibling; node && node.tagName === 'TEMPLATE' && node.hasAttribute('for'); node = node.previousElementSibling) templates.push(node);
  // A <?start name> or <?end>: a processing instruction, or the comment it parses as.
  var kind = function (node) {
    return node.nodeType === 7 ? node.target : node.nodeType === 8 ? (/^\?(start|end)\b/.exec(node.data) || [])[1] : null;
  };
  var started = host && host.matches(':state(hydrated), [data-hydrated]');
  for (var i = 0; i < templates.length; i++) {
    var template = templates[i];
    template.remove();
    if (!host || started) continue;
    var name = 'name="' + template.getAttribute('for') + '"';
    var start = null;
    var roots = host.shadowRoot ? [host.shadowRoot, host] : [host];
    for (var r = 0; r < roots.length && !start; r++) {
      var walker = document.createTreeWalker(roots[r], NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_PROCESSING_INSTRUCTION);
      for (var at = walker.nextNode(); at; at = walker.nextNode()) {
        if (kind(at) === 'start' && at.data.replace(/^\?start |\?$/g, '') === name) { start = at; break; }
      }
    }
    var end = start && start.nextSibling;
    for (var depth = 0; end; end = end.nextSibling) {
      if (kind(end) === 'start') depth++;
      else if (kind(end) === 'end' && depth-- === 0) break;
    }
    if (!end) continue;
    var range = document.createRange();
    range.setStartBefore(start);
    range.setEndAfter(end);
    range.deleteContents();
    range.insertNode(template.content);
  }
  var held = window.__zubraStream || {};
  for (var name in values) {
    var hold = held[id + ':' + name];
    if (values[name].error !== undefined) {
      var rejected = Promise.reject(new Error(values[name].error));
      rejected.catch(function () {});
      if (hold) hold.reject(new Error(values[name].error));
      else host[name] = rejected;
    } else {
      if (hold) hold.resolve(values[name].value);
      host[name] = values[name].value;
    }
    delete held[id + ':' + name];
  }
}`;

/** A rendered light-DOM host's children: between its start tag and its end tag. */
function lightContent(rendered, tag) {
  const open = rendered.match(/^\s*<[a-z][\w.-]*(?:\s[^>]*)?>/);
  const close = rendered.lastIndexOf(`</${tag}>`);
  if (!open || close < open[0].length) return null;
  return rendered.slice(open[0].length, close);
}

/** A form-associated component's value, as the form would submit it, in a hidden input. */
function fallbackInput(attributeText, info, props) {
  if (!info.form) return '';
  const name = parseAttributes(attributeText).name;
  const models = info.props.filter((prop) => prop.model);
  if (!name || models.length !== 1) return '';
  const value = models[0].name in props ? props[models[0].name] : models[0].default;
  if (value == null || value === false || value === '') return '';
  const text = value === true ? 'on' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `<input type="hidden" name="${escapeAttribute(name)}" value="${escapeAttribute(text)}" data-zb-fallback>`;
}

/** The relative specifiers (`./x.js`, `../x.js`) a module imports, statically or with `import()`. */
/**
 * ` nonce="…"` for an inline `<script>` or `<style>`, from `{ nonce }`: what a
 * Content-Security-Policy with `'nonce-…'` lets through. Base64 (or base64url) only, as the
 * policy's grammar has it, so it can't close the attribute.
 */
export function nonceAttribute(options) {
  const nonce = options?.nonce;
  if (nonce === undefined || nonce === null) return '';
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(nonce)) throw new Error('@zubra/server: nonce is the base64 value of the Content-Security-Policy\'s nonce (letters, digits, + / - _ and = padding)');
  return ` nonce="${nonce}"`;
}

/**
 * `code` with the bare specifiers its `import`s name resolved as an import map of `imports`
 * would: an exact entry, or the longest entry ending in "/" that the specifier starts with.
 * Relative paths, absolute paths and URLs are left alone, as is a specifier with no entry.
 */
export function resolveImports(code, imports) {
  const prefixes = Object.keys(imports).filter((key) => key.endsWith('/')).sort((a, b) => b.length - a.length);
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"\n]+)\2/g, (whole, before, quote, specifier) => {
    if (/^(?:\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(specifier)) return whole;
    if (Object.hasOwn(imports, specifier)) return `${before}${quote}${imports[specifier]}${quote}`;
    const prefix = prefixes.find((key) => specifier.startsWith(key));
    return prefix ? `${before}${quote}${imports[prefix]}${specifier.slice(prefix.length)}${quote}` : whole;
  });
}

/**
 * The specifiers of `code`'s static imports and re-exports (`import … from 'x'`, `import 'x'`,
 * `export … from 'x'`), minified or not. `import('x')` isn't among them: it loads when it runs.
 */
export function staticImports(code) {
  const found = [];
  const pattern = /(?:^|[^.\w$])(?:import|export)\s*(?:[\w$*{},\s]+?\bfrom\s*|[*{][^'"()]*?\bfrom\s*)?(['"])([^'"\n]+)\1/g;
  for (const match of code.matchAll(pattern)) found.push(match[2]);
  return found;
}

/**
 * What `specifier`, imported by the module at the absolute path `from`, resolves to: a path
 * for a relative or absolute one, the import map's answer (`imports`) for a bare one, and null
 * for a URL with a scheme or a bare specifier the map doesn't have.
 */
export function resolveSpecifier(specifier, from, imports) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(specifier) || specifier.startsWith('//')) return null;
  if (specifier.startsWith('/')) return specifier;
  if (specifier.startsWith('./') || specifier.startsWith('../')) return joinPath(from.slice(0, from.lastIndexOf('/')), specifier);
  if (Object.hasOwn(imports, specifier)) return imports[specifier];
  const prefix = Object.keys(imports).filter((key) => key.endsWith('/')).sort((a, b) => b.length - a.length).find((key) => specifier.startsWith(key));
  return prefix ? `${imports[prefix]}${specifier.slice(prefix.length)}` : null;
}

export function relativeImports(code) {
  const found = [];
  const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\.?\/[^'"\n]+)\1/g;
  for (const match of code.matchAll(pattern)) found.push(match[2]);
  return found;
}

/** `module` (`./x.js`, `../x.js`) joined to the folder `base`, with `.` and `..` resolved, as the
 * compiler joins a component's import to its path. */
export function joinPath(base, module) {
  if (!module.startsWith('./') && !module.startsWith('../')) return module;
  const parts = base ? base.split('/') : [];
  for (const part of module.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

/**
 * A short hash of `text` (cyrb53, as 11 base-36 digits): a name for a build of a module, so its
 * URL changes when it does. Not for anything a hash has to keep secret or unforgeable.
 */
export function hashOf(text) {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 2654435761);
    b = Math.imul(b ^ code, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36).padStart(11, '0');
}
