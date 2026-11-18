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
export async function buildRuntime({ keep = [], esbuild, ...options } = {}) {
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
  const zubra = createZubra({ ...options, production: true, devtools: false, cache: true, runtime: null });
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
  const entry = [...wanted].map(([file, set]) => `export { ${[...set].sort().join(', ')} } from './${file}';`).join('\n');
  let result;
  try {
    // remark.js stays the runtime's own file, beside this one: it imports nothing, and is only
    // loaded when server markup needs repair.
    result = await bundler.build({ stdin: { contents: entry, resolveDir: production, sourcefile: 'app-runtime.js' }, bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, external: ['./remark.js'], logLevel: 'silent' });
  } catch (error) {
    throw new Error(`@zubra/server/build: the runtime doesn't have a name a module imports: ${error.errors?.[0]?.text ?? error.message}`);
  }
  const code = result.outputFiles[0].text;
  return { file: `app-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`, code, names };
}

