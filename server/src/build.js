// Experimental (docs/stability.md). `buildRuntime()`: an app's own build of the runtime.
//
// `@zubra/server` can't remove what a page doesn't use from inside a runtime file: it has no
// bundler, by design (it runs at the edge and behind `zubra serve` from the compiler alone). An
// app that can install one gets the rest here: every name its components, the plain modules
// beside them and @zubra/sync import from the runtime is collected, and esbuild writes one
// module with those names and only what they reach.
//
//   import { buildRuntime } from '@zubra/server/build';
//   const runtime = await buildRuntime({ components: './components' });
//   const zubra = createZubra({ components: './components', runtime });
//
// `buildApp()` goes one step on: the same module also holds the app's components, and the page
// scripts you name. A page then loads one file, where it loaded the runtime, each component and
// each script of its own.
//
//   const app = await buildApp({ components: './components', scripts: ['./public/live.js'] });
//   const zubra = createZubra({ components: './components', runtime: app });
//
// It takes a fraction of a second, so building when the server starts is enough; the result is
// plain data (`{ file, code, names }`) if you would rather build once and keep it. Development
// ignores it. esbuild is the app's to install: this package doesn't depend on it.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from './index.js';

const require = createRequire(import.meta.url);

/** What `code` imports by name from the runtime: [file or entry, name] for each. */
function runtimeImports(code) {
  const found = [];
  for (const [, names, , specifier] of String(code).matchAll(/import\s*\{([^}]*)\}\s*from\s*(["'])(@zubra\/runtime(?:\/[\w-]+)?|(?:\.\.\/)+runtime\/[\w.-]+\.js)\2/g)) {
    const from = specifier.startsWith('@zubra/runtime') ? specifier.slice('@zubra/runtime'.length + 1) || 'core' : specifier.slice(specifier.lastIndexOf('/') + 1, -'.js'.length);
    for (const one of names.split(',').map((one) => one.trim()).filter(Boolean)) found.push([from, one.split(/\s+as\s+/)[0]]);
  }
  return found;
}

/**
 * Build the runtime for the app `options` describes (what you pass `createZubra`: `components`,
 * `packages`, `prefix`, `imports`, …). `keep`: more names of the script API to include, for a
 * `<script type="module">` of your own that imports `@zubra/runtime`. `esbuild`: the module, if
 * it isn't installed where this package can find it. Returns `{ file, code, names }`, to pass as
 * `createZubra({ runtime })`.
 */
export async function buildRuntime(options = {}) {
  return build(options, false);
}

/**
 * Build one module for the whole app: the runtime as `buildRuntime()` makes it, every component
 * of the app, the plain modules they import, and `scripts` (paths of browser modules of your
 * own, run for their effects: a page's live-update script, `@zubra/actions`' form script). A
 * page of `createZubra({ runtime })` then has that module as its only script. Every page of the
 * app loads the same one, so it is cached once; it defines every component, used on the page
 * or not. Returns `{ file, code, names, components, scripts }`.
 */
export async function buildApp(options = {}) {
  return build(options, true);
}

async function build({ keep = [], esbuild, scripts = [], ...options }, whole) {
  const signals = options.signals === true;
  let bundler = esbuild;
  if (!bundler) {
    try {
      bundler = await import('esbuild');
    } catch {
      try {
        bundler = require(createRequire(join(process.cwd(), 'package.json')).resolve('esbuild'));
      } catch {
        throw new Error('@zubra/server/build: buildRuntime() needs esbuild, which this package does not depend on. Install it in the app (npm install --save-dev esbuild), or pass it: buildRuntime({ esbuild })');
      }
    }
  }
  if (options.imports?.['@zubra/runtime']) throw new Error("@zubra/server/build: `imports['@zubra/runtime']` says the runtime is served from somewhere else, so there is nothing here to build");
  // What a production server sends without a built runtime: every module with its runtime
  // imports already taken from the file that has each name.
  const zubra = createZubra({ ...options, production: true, devtools: false, cache: true, runtime: null, minify: false });
  const prefix = (options.prefix ?? '/_zubra').replace(/\/$/, '');
  const text = async (path) => {
    const response = await zubra.fetch(new Request(`http://localhost${prefix}/${path}`));
    return response && response.status === 200 ? response.text() : null;
  };
  const wanted = new Map(); // production file -> names
  const want = (from, name) => {
    // In the split build the base is `zubra.js`; file by file it is `base.js`.
    const file = `${from === 'zubra' ? 'base' : from}.js`;
    if (file === 'legacy.js') throw new Error(`@zubra/server/build: a component here was compiled by an older Zubra (it asks for ${name}); a built runtime can't serve it. Compile it again, or leave \`runtime\` out`);
    wanted.set(file, (wanted.get(file) ?? new Set()).add(name));
  };
  for (const name of zubra.names) for (const [from, one] of runtimeImports(zubra.module(name))) want(from, one);
  // The plain modules beside the components, and @zubra/sync's where it is installed.
  const folder = resolve(options.components ?? 'components');
  const plain = existsSync(folder) ? readdirSync(folder, { recursive: true }).filter((file) => /\.m?js$/.test(file)).map((file) => `components/${String(file).split(sep).join('/')}`) : [];
  for (const path of [...plain, 'sync/index.js', 'sync/connect.js', 'sync/follow.js', 'sync/webrtc.js']) {
    const code = await text(path);
    if (code !== null) for (const [from, one] of runtimeImports(code)) want(from, one);
  }
  for (const one of keep) want('core', one);
  if (!wanted.size) want('core', '$component');

  const production = join(dirname(fileURLToPath(import.meta.resolve('@zubra/runtime'))), '..', 'dist', 'production');
  for (const file of wanted.keys()) if (!existsSync(join(production, file))) throw new Error(`@zubra/server/build: @zubra/runtime has no ${file} (a module asks for ${[...wanted.get(file)].join(', ')}). The runtime may be older than this package`);
  const names = [...new Set([...wanted.values()].flatMap((set) => [...set]))].sort();
  const components = whole ? [...zubra.names].sort() : [];
  const own = whole ? scripts.map((path) => resolve(path)) : [];
  for (const path of own) if (!existsSync(path)) throw new Error(`@zubra/server/build: no script at ${path}`);
  const entry = [
    ...[...wanted].map(([file, set]) => `export { ${[...set].sort().join(', ')} } from './${file}';`),
    ...components.map((name) => `import ${JSON.stringify(`zubra-app:components/${name}.js`)};`),
    ...own.map((path) => `import ${JSON.stringify(path)};`),
  ].join('\n');
  // The runtime by any of its names is the production build's file; a component's module, and a
  // plain module beside it, is what the server would send (read from it, not from disk: the
  // compiled module, with what it needs written in). Everything else a module imports by name
  // (`@zubra/sync`, a package) stays an import, for the page's import map.
  const runtimeFile = (file) => join(production, file === 'zubra.js' ? 'base.js' : file);
  const plugin = {
    name: 'zubra-app',
    setup(bundle) {
      bundle.onResolve({ filter: /^@zubra\/runtime(?:\/[\w-]+)?$/ }, (args) => ({ path: runtimeFile(`${args.path.slice('@zubra/runtime'.length + 1) || 'core'}.js`) }));
      // @zubra/sync stays the server's to send, from a script of the app's as from a component:
      // one copy of its store, whichever asks.
      bundle.onResolve({ filter: /^@zubra\/sync(?:\/[\w-]+)?$/ }, (args) => ({ path: args.path, external: true }));
      bundle.onResolve({ filter: /^zubra-app:/ }, (args) => ({ path: args.path.slice('zubra-app:'.length), namespace: 'zubra-app' }));
      bundle.onResolve({ filter: /^\.\.?\//, namespace: 'zubra-app' }, (args) => {
        const path = new URL(args.path, `http://app/${args.importer}`).pathname.slice(1);
        if (path.startsWith('runtime/')) return { path: runtimeFile(path.slice('runtime/'.length)) };
        return path.startsWith('components/') ? { path, namespace: 'zubra-app' } : { path: args.path, external: true };
      });
      bundle.onResolve({ filter: /^[^./]/, namespace: 'zubra-app' }, (args) => ({ path: args.path, external: true }));
      bundle.onLoad({ filter: /.*/, namespace: 'zubra-app' }, async (args) => {
        const name = args.path.slice('components/'.length, -'.js'.length);
        const code = zubra.names.includes(name) ? zubra.module(name) : await text(args.path);
        if (code === null) return { errors: [{ text: `no module at ${args.path}` }] };
        return { contents: String(code), loader: 'js', resolveDir: production };
      });
    },
  };
  // Signals mode: the TC39 engine where the runtime imports its engine.
  const engine = {
    name: 'zubra-engine',
    setup(bundle) {
      bundle.onResolve({ filter: /^\.\/signal\.js$/ }, (args) => (args.resolveDir === production ? { path: join(production, 'signal-tc39.js') } : undefined));
    },
  };
  if (signals && !existsSync(join(production, 'signal-tc39.js'))) throw new Error('@zubra/server/build: signals: true needs @zubra/runtime 6.0 or later, which has signals mode (signal-tc39.js)');
  let result;
  try {
    // remark.js stays the runtime's own file, beside this one: it imports nothing, and is only
    // loaded when server markup needs repair.
    result = await bundler.build({ stdin: { contents: entry, resolveDir: production, sourcefile: 'app-runtime.js' }, bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, external: ['./remark.js'], logLevel: 'silent', plugins: [...(whole ? [plugin] : []), ...(signals ? [engine] : [])] });
  } catch (error) {
    throw new Error(whole && !/No matching export/.test(error.errors?.[0]?.text ?? '') ? `@zubra/server/build: ${error.errors?.[0]?.text ?? error.message}` : `@zubra/server/build: the runtime doesn't have a name a module imports: ${error.errors?.[0]?.text ?? error.message}`);
  }
  const code = result.outputFiles[0].text;
  const file = `app-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`;
  const built = whole ? { file, code, names, components, scripts: own.length > 0 } : { file, code, names };
  // (So that a server with a different `signals` refuses it.)
  if (signals) built.signals = true;
  return built;
}

