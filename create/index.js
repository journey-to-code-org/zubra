#!/usr/bin/env node
// create-zubra: write a working app that uses zubra components.
//
//   npm create zubra                         asks for a directory and a framework
//   npm create zubra my-app -- --framework react
//   npm create zubra my-app -- --framework vue --typescript
//
// The app has a starter page made of small example components (src/components/: a counter, a
// list, a form control, async data, slots), the plugin wired up, typings, an AGENTS.md and a
// browser test (`npm test`). `--framework server` is a Node server instead of a bundler's app:
// pages rendered by @zubra/server and a form's function run by @zubra/actions, with no build
// step. With --typescript the counter is `<script lang="ts">`, and
// `npm run check` type-checks it (`zubra check --types`). Nothing is installed: the last lines
// say what to run. A script run before that (`predev` and the rest) says to install, instead
// of the shell reporting that `vite` is missing.
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

export const FRAMEWORKS = {
  vanilla: 'Vanilla: no framework (plain HTML and JavaScript)',
  react: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  solid: 'Solid',
  preact: 'Preact',
  lit: 'Lit',
  angular: 'Angular',
  astro: 'Astro (server-rendered pages)',
  server: 'Server-rendered (a Node server with forms, no bundler)',
};

const templates = fileURLToPath(new URL('./templates/', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** The TypeScript the --typescript apps check with (Angular's own template pins the same). */
export const TYPESCRIPT = '~6.0.3';

/** No framework is `vanilla`; these are its other names, as in `zubra compile --framework`. */
const ALIASES = { element: 'vanilla', none: 'vanilla', plain: 'vanilla' };

/** Node requirements of the starter's framework and build tools. */
export function nodeRequirement(framework) {
  const atLeast = (version, major, minor = 0, patch = 0) => {
    const parts = version.split('.').map(Number);
    return parts[0] > major || (parts[0] === major && (parts[1] > minor || (parts[1] === minor && parts[2] >= patch)));
  };
  const major = (version) => Number(version.split('.')[0]);
  const vite = (version) => (major(version) === 20 && atLeast(version, 20, 19)) || atLeast(version, 22, 12);
  if (framework === 'server') return { range: '>=20.19.0', supports: (version) => atLeast(version, 20, 19) };
  if (framework === 'astro') return { range: '>=22.23.4', supports: (version) => atLeast(version, 22, 23, 4) };
  if (framework === 'angular') return { range: '^22.22.3 || ^24.15.0 || >=26.0.0', supports: (version) => (major(version) === 22 && atLeast(version, 22, 22, 3)) || (major(version) === 24 && atLeast(version, 24, 15)) || atLeast(version, 26) };
  if (framework === 'svelte') return { range: '^20.19.0 || ^22.12.0 || >=24.0.0', supports: (version) => (major(version) === 20 && atLeast(version, 20, 19)) || (major(version) === 22 && atLeast(version, 22, 12)) || atLeast(version, 24) };
  return { range: '^20.19.0 || >=22.12.0', supports: vite };
}

/**
 * Write the app for `framework` into `dir` (which must be empty or missing); returns the files
 * written. `typescript`: the component in TypeScript, and `npm run check` to type-check it.
 */
export function create(dir, framework, { name = basename(resolve(dir)), typescript = false } = {}) {
  framework = ALIASES[framework] ?? framework;
  if (!(framework in FRAMEWORKS)) throw new Error(`create-zubra: unknown framework "${framework}"; one of ${Object.keys(FRAMEWORKS).join(', ')}`);
  const target = resolve(dir);
  if (existsSync(target) && readdirSync(target).length) throw new Error(`create-zubra: ${dir} isn't empty`);
  // (The server app has no build step, so not the shared test's build helper.)
  cpSync(join(templates, 'shared'), target, { recursive: true, filter: (from) => !(framework === 'server' && from.endsWith(join('test', 'build.js'))) });
  cpSync(join(templates, framework), target, { recursive: true });
  if (typescript) {
    // The component in TypeScript, and a tsconfig.json unless the framework has its own.
    const own = existsSync(join(target, 'tsconfig.json'));
    cpSync(join(templates, 'typescript'), target, { recursive: true, filter: (from) => !(own && from.endsWith('tsconfig.json')) });
    // React's .tsx files: `jsx` to check them, and `allowArbitraryExtensions` so an import of
    // `./x.zb` is typed from the `x.d.zb.ts` the build plugin writes beside it (without it, it's
    // `any`, and a wrong prop passes). The other frameworks check their own files their own way.
    if (framework === 'react' && !own) {
      const path = join(target, 'tsconfig.json');
      const config = JSON.parse(readFileSync(path, 'utf8'));
      config.compilerOptions.jsx = 'react-jsx';
      config.compilerOptions.allowArbitraryExtensions = true;
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    }
    const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
    manifest.devDependencies = { ...manifest.devDependencies, typescript: manifest.devDependencies?.typescript ?? TYPESCRIPT };
    manifest.scripts = { ...manifest.scripts, precheck: 'node scripts/ensure-installed.js', check: 'zubra check --types src' };
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    // And the README and AGENTS.md say so.
    const readme = join(target, 'README.md');
    writeFileSync(readme, readFileSync(readme, 'utf8')
      .replace(/^npm test {8}# /m, 'npm run check   # type-checks the components: scripts, templates, props and events\n$&')
      .replace('- `src/components/` holds the components: one `.zb` file each, with its script, styles and template.', '- `src/components/` holds the components: one `.zb` file each, with its script, styles and template. `hello-counter.zb` is in TypeScript (`<script lang="ts">`, with an `interface Props`); the others are plain JavaScript, and a file becomes TypeScript when you add `lang="ts"` to it. `npm run check` is `zubra check --types`: your TypeScript checks each script, every `{…}` of its template, and the props and events of the components it uses, in both kinds of file; run it in CI.'));
    const agents = join(target, 'AGENTS.md');
    writeFileSync(agents, readFileSync(agents, 'utf8').replace('`npm run dev` runs the app', '`npm run check` type-checks every component (after a change, it should report nothing); `npm run dev` runs the app'));
  }
  const manifestPath = join(target, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.engines = { ...manifest.engines, node: nodeRequirement(framework).range };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // npm drops .gitignore files from packages, so the template's is named _gitignore.
  renameSync(join(target, '_gitignore'), join(target, '.gitignore'));
  const files = walk(target);
  const values = { name: packageName(name), title: name.replace(/[<>{}"'`&\\$]/g, '') || 'Zubra app', version, framework: framework === 'vanilla' ? 'plain HTML and JavaScript' : FRAMEWORKS[framework].replace(/ \(.*/, '') };
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const filled = text.replace(/\{\{(name|title|version|framework)\}\}/g, (_, key) => values[key]);
    if (filled !== text) writeFileSync(file, filled);
  }
  return files.map((file) => relative(target, file)).sort();
}

const walk = (dir) => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

const packageName = (name) => name.toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[-._]+|[-._]+$/g, '') || 'zb-app';

/** `[dir] [--framework <name>] [--typescript] [--yes]` → `{ dir, framework, typescript, yes, help }`. */
export function parse(argv) {
  const options = { dir: null, framework: null, typescript: null, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--framework' || arg === '-f' || arg === '--template' || arg === '-t') {
      if (!argv[i + 1] || argv[i + 1].startsWith('-')) throw new Error(`create-zubra: ${arg} requires a framework`);
      options.framework = argv[++i];
    } else if (arg.startsWith('--framework=') || arg.startsWith('--template=')) {
      options.framework = arg.slice(arg.indexOf('=') + 1);
      if (!options.framework) throw new Error(`create-zubra: ${arg} requires a framework`);
    } else if (arg === '--typescript' || arg === '--ts') options.typescript = true;
    else if (arg === '--javascript' || arg === '--js') options.typescript = false;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('-') && !options.dir) options.dir = arg;
    else throw new Error(`create-zubra: unexpected argument ${arg}`);
  }
  return options;
}

async function main(argv) {
  const options = parse(argv);
  if (options.help) {
    console.log(`usage: npm create zubra [directory] -- [--framework ${Object.keys(FRAMEWORKS).join('|')}] [--typescript] [--yes]`);
    return;
  }
  const ask = !options.yes && process.stdin.isTTY;
  const prompt = ask ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    let { dir, framework } = options;
    if (!dir) dir = ask ? (await prompt.question('Directory (zb-app): ')).trim() || 'zb-app' : 'zb-app';
    if (!framework) {
      const names = Object.keys(FRAMEWORKS);
      if (ask) {
        console.log(names.map((key, i) => `  ${i + 1}. ${FRAMEWORKS[key]}`).join('\n'));
        const answer = (await prompt.question('Framework (1): ')).trim();
        framework = names[Number(answer || 1) - 1] ?? answer;
      } else {
        framework = 'vanilla';
      }
    }
    let { typescript } = options;
    if (typescript === null) {
      typescript = ask ? /^y/i.test((await prompt.question('TypeScript in components? (y/N): ')).trim()) : false;
    }
    framework = ALIASES[framework] ?? framework;
    if (framework in FRAMEWORKS) {
      const { range, supports } = nodeRequirement(framework);
      if (!supports(process.versions.node)) throw new Error(`create-zubra: ${framework} requires Node ${range}; you have ${process.versions.node}. Upgrade Node and try again.`);
    }
    create(dir, framework, { typescript });
    const cd = relative(process.cwd(), resolve(dir)) || '.';
    const cdArg = cd.includes(' ') ? `"${cd}"` : cd;
    const cdStep = cd === '.' ? '' : /^[\w.\\/: -]+$/.test(cd)
      ? process.platform === 'win32' && /^[a-z]:\\/i.test(cd)
        ? `  PowerShell: cd ${cdArg}\n  cmd: cd /d ${cdArg}\n`
        : `  cd ${cdArg}\n`
      : '  Change into the directory shown above\n';
    const check = typescript ? '  npm run check   type-checks the components (zubra check --types)\n' : '';
    console.log(`\nA Zubra app (${FRAMEWORKS[framework]}${typescript ? ', TypeScript' : ''}) is in ${cd}. Next:\n\n${cdStep}  npm install\n${framework === 'server' ? '  npm run dev     http://localhost:3000; edit src/components/hello-counter.zb and save: it updates in place\n  npm test        starts the server and uses the page in Chromium, with JavaScript and without\n' : '  npm run dev     edit src/components/hello-counter.zb: it updates in place\n  npm test        builds the app and clicks through it in Chromium\n'}  npx playwright install chromium   install Chromium once for npm test\n${check}\nThe page is made of the examples in src/components/ (a list, a form control, async data, slots):\nread them there, and AGENTS.md for how it all fits together.\n`);
  } finally {
    prompt?.close();
  }
}

// Run as a command (npm's bin is a link to this file), not imported.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
