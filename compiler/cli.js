#!/usr/bin/env node
// `zubra` from npm (@zubra/compiler): the WebAssembly compiler on the command line, with no Rust.
// The commands, their flags and values, and the help come from the compiler (src/cli.rs), the
// table the native CLI parses with, so the two take the same command lines: `zubra --help`.
// Exit codes: 0 success (warnings included), 1 errors in the input, 2 a usage error.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { compileFile, format, request, sources } from './index.js';
import { buildLibrary } from './library.js';
import { loadComponents, serve as serveMcp } from './mcp.js';
import { buildEmbed } from './embed.js';
import { checkTypes, formatDiagnostic } from './typecheck.js';
import { solidOf } from './solid.js';

const here = dirname(fileURLToPath(import.meta.url));

/** The component registry: shipped in the package, or the repository's when run from a checkout. */
export function registryDir() {
  for (const dir of [join(here, 'registry'), join(here, '../registry')]) {
    if (existsSync(join(dir, 'index.json'))) return dir;
  }
  throw new Error('zubra add: the component registry is missing from this install');
}

export function readRegistry(dir = registryDir()) {
  return JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8'));
}

/**
 * Copy registry components (and those they use) into `target`. Returns the files written.
 * An existing file is an error unless `force`, so your edits are never overwritten.
 */
export function add(names, { target = 'src/components', force = false, registry = registryDir() } = {}) {
  const { components } = readRegistry(registry);
  const byName = new Map(components.map((component) => [component.name, component]));
  const wanted = new Set();
  const visit = (name) => {
    const component = byName.get(name);
    if (!component) {
      const near = [...byName.keys()].filter((candidate) => candidate.startsWith(name.slice(0, 3)) || distance(candidate, name) <= 2);
      throw new Error(`zubra add: no component "${name}" in the registry${near.length ? `; did you mean ${near.join(', ')}?` : ''} (zubra add --list)`);
    }
    if (wanted.has(name)) return;
    wanted.add(name);
    for (const dependency of component.dependencies ?? []) visit(dependency);
  };
  for (const name of names) visit(name);
  const files = [...wanted].flatMap((name) => byName.get(name).files);
  mkdirSync(target, { recursive: true });
  const clashes = files.filter((file) => existsSync(join(target, file)));
  if (clashes.length && !force) throw new Error(`zubra add: ${clashes.map((file) => join(target, file)).join(', ')} already exists (--force replaces it)`);
  for (const file of files) copyFileSync(join(registry, 'components', file), join(target, file));
  return files.map((file) => join(target, file));
}

/** The npm packages the added files import (beyond the runtime), from the registry's index. */
export function packagesFor(files, registry = registryDir()) {
  const added = new Set(files.map((file) => basename(file)));
  const { components } = readRegistry(registry);
  return [...new Set(components.filter((component) => component.files.some((file) => added.has(file))).flatMap((component) => component.packages ?? []))];
}

/** Edit distance, for "did you mean". */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}

/** `.zb` files under `path` (or `path` itself), skipping node_modules, dist, target and dot-folders. */
function componentsIn(path, found = [], extensions = ['.zb']) {
  if (!statSync(path).isDirectory()) return found.push(path), found;
  for (const name of readdirSync(path).sort()) {
    const child = join(path, name);
    if (statSync(child).isDirectory()) {
      if (!name.startsWith('.') && !['node_modules', 'dist', 'target'].includes(name)) componentsIn(child, found, extensions);
    } else if (extensions.some((extension) => name.endsWith(extension))) found.push(child);
  }
  return found;
}

/** What `zubra check` checks: each file named, and every component (in JSX too) under each folder. */
function checkedIn(paths) {
  return paths.flatMap((path) => {
    if (!existsSync(path) || !statSync(path).isDirectory()) return [path];
    const found = componentsIn(path, [], ['.zb', '.zb.jsx', '.zb.tsx']);
    if (!found.length) throw new Error(`${path}: no components (.zb, .zb.jsx, .zb.tsx) in this folder`);
    return found;
  });
}

/** The frameworks typings can be for, by the npm package an app that uses one depends on. */
const FRAMEWORKS = { react: 'react', vue: 'vue', svelte: 'svelte', 'solid-js': 'solid' };

/**
 * The framework of the app at `root`: the one in its package.json, or `none` (the elements).
 * Solid is `solid` or `solid2`, by the version installed (see solid.js).
 */
function frameworkOf(root) {
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { /* no package.json: the elements */ }
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
  const found = [...new Set(names.filter((name) => name in FRAMEWORKS).map((name) => FRAMEWORKS[name]))];
  if (found.length > 1) throw new Error(`zubra types: package.json depends on ${found.join(' and ')}: say which the typings are for with --framework ${found.join('|')}`);
  return found[0] === 'solid' ? solidOf(root) : (found[0] ?? 'none');
}

/**
 * `zubra types`: write the typings of the components in `paths` (files or folders; default, the
 * root) where @zubra/unplugin's `dts: { dir }` writes them during a build, so `tsc` can run on a
 * fresh checkout before one. `dir` mirrors `root`: `src/rating.zb` is typed by
 * `<dir>/src/rating.d.zb.ts`, and a component above the root by a `__` per folder up, with the
 * `rootDirs` that pair them in `<dir>/tsconfig.json` (plugin/src/index.js has the same layout).
 * Returns the framework and the files written.
 */
export function writeTypes(paths, { dir = '.zubra/types', framework, root = process.cwd() } = {}) {
  const base = resolve(root);
  const out = resolve(base, dir);
  // `vanilla` is no framework (the elements); `none`, `element` and `plain` say the same.
  if (['vanilla', 'none', 'element', 'plain'].includes(framework)) framework = 'none';
  if (framework !== undefined && framework !== 'none' && framework !== 'solid2' && !Object.values(FRAMEWORKS).includes(framework)) {
    throw new Error(`zubra types: --framework is ${Object.values(FRAMEWORKS).join(', ')}, solid2 or vanilla, not "${framework}"`);
  }
  framework ??= frameworkOf(base);
  const components = (paths.length ? paths : [base]).flatMap((path) => {
    if (!existsSync(path)) throw new Error(`zubra types: ${path} doesn't exist`);
    return componentsIn(resolve(path));
  });
  const config = join(out, 'tsconfig.json');
  let levels = 1;
  try { levels = Math.max(1, JSON.parse(readFileSync(config, 'utf8')).compilerOptions.rootDirs.length / 2); } catch { /* none yet */ }
  const files = [];
  const errors = [];
  for (const component of [...new Set(components)]) {
    const folders = relative(base, dirname(component));
    if (isAbsolute(folders)) continue; // another drive: nothing to mirror
    const parts = folders.split(sep).filter(Boolean);
    const response = compileFile(component, { emit: 'dts', framework });
    if (!response.ok) {
      errors.push(response.error);
      continue;
    }
    levels = Math.max(levels, parts.filter((part) => part === '..').length + 1);
    const target = join(out, ...parts.map((part) => (part === '..' ? '__' : part)), `${basename(component, '.zb')}.d.zb.ts`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, response.output);
    files.push(target);
  }
  if (files.length) {
    const posix = (folder) => folder.split(sep).join('/') || '.';
    const rootDirs = [];
    for (let level = 0; level < levels; level++) {
      rootDirs.push(posix(relative(out, resolve(base, ...Array(level).fill('..')))), posix(join('.', ...Array(level).fill('__'))));
    }
    writeFileSync(config, `${JSON.stringify({ compilerOptions: { allowArbitraryExtensions: true, rootDirs } }, null, 2)}\n`);
  }
  return { framework, files, errors };
}

/** `zubra fmt`: as the Rust CLI's (src/main.rs): format in place, or --check, or --stdin. */
function fmt(command, { flags, rest: paths }) {
  const number = (value, flag) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`${flag} takes a positive number`);
    return parsed;
  };
  const options = { indentWidth: number(flags.indent, '--indent'), useTabs: flags.tabs, printWidth: number(flags.width, '--width') };
  if (flags.stdin) {
    if (flags.check || paths.length > 1) throw misuse(command, '--stdin takes at most one path (for messages), and not --check');
    process.stdout.write(format(readFileSync(0, 'utf8'), { ...options, path: paths[0] ?? '<stdin>' }));
    return;
  }
  if (!paths.length) throw misuse(command, 'missing the files or folders to format');
  for (const path of paths) if (!existsSync(path)) throw new Error(`no such file: ${path}`);
  const changed = [];
  let failed = 0;
  for (const file of paths.flatMap((path) => componentsIn(path))) {
    const source = readFileSync(file, 'utf8');
    let formatted;
    try {
      formatted = format(source, { ...options, path: file });
    } catch (error) {
      process.stderr.write(error.message);
      failed++;
      continue;
    }
    if (formatted === source) continue;
    if (!flags.check) writeFileSync(file, formatted);
    changed.push(file);
    console.log(`${flags.check ? 'would format' : 'formatted'} ${file}`);
  }
  if (failed) throw new Error(`${failed} file${failed === 1 ? '' : 's'} couldn't be formatted`);
  if (flags.check && changed.length) throw new Error(`${changed.length} file${changed.length === 1 ? ' is' : 's are'} not formatted; run zubra fmt`);
}

/** A usage error: exit code 2 (an error in the input is 1). */
class UsageError extends Error {}

/** The command line's contract, from the compiler (src/cli.rs), so both CLIs take the same commands, flags and values. */
let contract = null;
function spec() {
  contract ??= request({ command: 'cli' }).output;
  return contract;
}

/** Edit distance and the near name, as the native CLI's (src/cli.rs), for "did you mean". */
function nearest(given, candidates) {
  let best = null;
  for (const candidate of candidates) {
    const d = distance(given, candidate);
    if (d <= Math.max(2, Math.floor(candidate.length / 4)) && d < candidate.length && (!best || d < best[0])) best = [d, candidate];
  }
  return best?.[1] ?? null;
}

function unknown(what, given, candidates) {
  const near = nearest(given, candidates);
  return `unknown ${what} \`${given}\`${near ? `; did you mean \`${near}\`?` : ''}`;
}

const canonical = (flag, value) => spec().aliases.find(([name, alias]) => name === flag && alias === value)?.[2] ?? value;

/** `args` against the command's row: `{ flags: { name: value | true }, rest }`, or a UsageError. */
function parse(command, args) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('-') || arg === '-') {
      rest.push(arg);
      continue;
    }
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = equals < 0 ? arg : arg.slice(0, equals);
    const flag = command.flags.find((candidate) => candidate.name === name);
    if (!flag) throw new UsageError(`${unknown('flag', name, command.flags.map((candidate) => candidate.name))}\nrun \`zubra ${command.name} --help\` for its options`);
    let value = true;
    if (!flag.value) {
      if (equals >= 0) throw new UsageError(`\`${name}\` takes no value`);
    } else {
      value = equals >= 0 ? arg.slice(equals + 1) : args[++i];
      if (value === undefined) throw new UsageError(`\`${name}\` needs a value: ${name} ${flag.values.length ? flag.values.join('|') : '<…>'}`);
      if (flag.values.length && !flag.values.includes(canonical(name, value))) {
        throw new UsageError(`${unknown(`${name} value`, value, flag.values)}; expected ${flag.values.join(', ')}`);
      }
      value = canonical(name, value);
    }
    flags[name.slice(2)] = value;
  }
  return { flags, rest };
}

/** A usage error with the command's synopsis, as the native CLI gives it. */
function misuse(command, problem) {
  return new UsageError(`${problem}\nusage: ${command.synopsis}`);
}

const version = () => JSON.parse(readFileSync(join(here, 'package.json'), 'utf8')).version;

/** A path as the native CLI shows it: relative to where it runs, for a file under it. */
const shown = (file) => (file.startsWith(process.cwd() + sep) ? relative(process.cwd(), file) : file);

/** Whether a component is TypeScript, whose types only `--types` checks. */
const isTypescript = (path, source) => path.endsWith('.zb.tsx') || /<script\b[^>]*\blang\s*=\s*["']?ts(?![\w-])/i.test(source);

/** Read a file, or say plainly that it isn't there. */
function readSource(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new Error(error.code === 'ENOENT' ? `no such file: ${path}` : `${path}: unable to read source: ${error.message}`);
  }
}

function check(command, { flags, rest }) {
  if (!rest.length) throw misuse(command, 'missing the files or folders to check');
  if (flags.keep && !flags.types) throw misuse(command, '--keep goes with --types');
  const json = flags.format === 'json';
  if (flags.types) {
    const { diagnostics, checked } = checkTypes(rest, { keep: flags.keep });
    if (json) {
      // As `check --format json`: one array, with TypeScript's code (TS2322).
      process.stdout.write(`${JSON.stringify(diagnostics.map(({ file, line, column, code, message, help }) => ({ file: shown(file), code, line, column, severity: 'error', message, help: help ?? null })), null, 2)}\n`);
      if (diagnostics.length) process.exitCode = 1;
      return;
    }
    for (const diagnostic of diagnostics) process.stderr.write(`${formatDiagnostic(diagnostic)}\n`);
    if (diagnostics.length) {
      process.stderr.write(`${diagnostics.length} type error${diagnostics.length === 1 ? '' : 's'} in ${checked} component${checked === 1 ? '' : 's'}\n`);
      process.exitCode = 1;
    } else process.stderr.write(`checked the types of ${checked} component${checked === 1 ? '' : 's'}: no errors\n`);
    return;
  }
  if (flags.stdin && rest.length !== 1) throw misuse(command, '--stdin takes one path: where the text on standard input is');
  const files = flags.stdin ? rest : checkedIn(rest);
  const report = [];
  let human = '';
  let errors = 0;
  let warnings = 0;
  let typescript = false;
  for (const file of files) {
    const absolute = resolve(file);
    const source = flags.stdin ? readFileSync(0, 'utf8') : readSource(file);
    typescript ||= isTypescript(file, source);
    const sent = sources(absolute);
    sent[absolute] = source;
    const response = request({ command: 'check', path: absolute, files: sent, server: flags.server, client: flags.client });
    let failed = false;
    for (const diagnostic of response.diagnostics) {
      const { file: at, code, line, column, severity, message, help } = diagnostic;
      report.push({ file: at === absolute ? file : shown(at), code, line, column, severity, message, help: help ?? null });
      if (severity === 'warning') warnings++;
      else failed = true;
    }
    if (failed || !response.ok) errors++;
    for (const warning of response.warnings) human += warning;
    if (!response.ok) human += response.error.endsWith('\n') ? response.error : `${response.error}\n`;
    if (response.client) {
      human += response.client.length
        ? `${file}: needs its module in the browser: ${response.client.join('; ')}\n`
        : `${file}: no client JavaScript needed: its server HTML is complete (0 KB), unless a page changes its props from script\n`;
      report.push({ file, severity: 'info', client: response.client });
    }
  }
  if (json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    process.stderr.write(human);
    if (!errors) {
      process.stderr.write(`checked ${files.length} file${files.length === 1 ? '' : 's'}: no errors\n`);
      if (typescript) process.stderr.write('TypeScript types weren\'t checked: add --types\n');
    }
  }
  if (errors) {
    if (!json) process.stderr.write(`${errors} file${errors === 1 ? '' : 's'} with errors\n`);
    process.exitCode = 1;
  } else if (flags['deny-warnings'] && warnings) {
    if (!json) process.stderr.write(`${warnings} warning${warnings === 1 ? '' : 's'} (--deny-warnings)\n`);
    process.exitCode = 1;
  }
}

function compile(command, { flags, rest }) {
  if (!rest.length) throw misuse(command, 'missing the component to compile');
  if (rest.length > 1) throw misuse(command, `\`zubra compile\` takes one component; \`${rest[1]}\` is a second`);
  const emit = flags.emit ?? 'html';
  if (emit !== 'html' && (flags.props || flags.slots || flags['slots-html'] || flags.partial)) {
    throw misuse(command, `--props, --slots, --slots-html and --partial apply to --emit html, not --emit ${emit}`);
  }
  if (flags.devtools && emit !== 'js') throw misuse(command, `--devtools applies to --emit js, not --emit ${emit}`);
  if (!flags['css-import'] !== !flags['css-import-inline']) throw misuse(command, '--css-import and --css-import-inline go together');
  const file = rest[0];
  const absolute = resolve(file);
  const files = sources(absolute);
  files[absolute] = readSource(file);
  const json = (path, what) => {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      throw new Error(`${path}: unable to read ${what}: ${error.message}`);
    }
  };
  const response = request({
    command: 'compile', emit, path: absolute, files,
    framework: flags.framework, runtime: flags.runtime, partial: flags.partial,
    props: flags.props ? json(flags.props, 'props') : undefined,
    slots: flags.slots ? json(flags.slots, 'slots') : undefined,
    slotSource: flags['slots-html'] ? 'html' : undefined,
    keepImports: flags['keep-imports'], noImports: flags['no-imports'], devtools: flags.devtools,
    binderEntries: flags['binder-entries'], clientOnly: flags['client-only'],
    cssImport: flags['css-import'], cssImportInline: flags['css-import-inline'], modulePath: flags['module-path'],
  });
  for (const warning of response.warnings) process.stderr.write(warning);
  if (!response.ok) throw new Error(response.error);
  if (flags.output) writeFileSync(flags.output, response.output);
  // Server HTML ends with a newline on a terminal, as the native CLI's does.
  else process.stdout.write(emit === 'html' ? `${response.output}\n` : response.output);
}

function convert(command, { flags, rest }) {
  if (!rest.length) throw misuse(command, 'missing the file to convert');
  if (rest.length > 1) throw misuse(command, `\`zubra convert\` takes one file; \`${rest[1]}\` is a second`);
  const path = resolve(rest[0]);
  const response = request({ command: 'convert', path, files: { [path]: readSource(rest[0]) }, prefix: flags.prefix, component: flags.component, as: flags.as });
  if (!response.ok) throw new Error(response.error);
  for (const change of response.changes) process.stderr.write(`${rest[0]}: ${change}\n`);
  if (flags.stdout) process.stdout.write(response.output);
  else {
    const target = flags.out ?? relative(process.cwd(), response.file);
    writeFileSync(target, response.output);
    process.stderr.write(`${rest[0]}: wrote ${target} (<${response.tag}>)\n`);
  }
  for (const warning of response.warnings) process.stderr.write(warning);
  if (!response.complete) {
    process.stderr.write(`${response.diagnostics.length} thing${response.diagnostics.length === 1 ? '' : 's'} to finish by hand (above)\n`);
    process.exitCode = 1;
  }
}

/** One request's text in, its response out, as the native `zubra request` and `zubra serve`. */
function answer(text) {
  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return { ok: false, output: null, error: `the request isn't JSON: ${error.message}`, warnings: [], diagnostics: [] };
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, output: null, error: 'the request must be a JSON object', warnings: [], diagnostics: [] };
  return request(body);
}

async function serveLines() {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    process.stdout.write(`${JSON.stringify(answer(line))}\n`);
  }
}

function main(argv) {
  const [name, ...args] = argv;
  const help = (arg) => arg === '-h' || arg === '--help';
  if (name === undefined) throw new UsageError(spec().help);
  if (help(name) || name === 'help') {
    const topic = help(args[0] ?? '') ? undefined : args[0];
    if (topic === undefined) return void process.stdout.write(spec().help);
    const found = spec().commands.find((command) => command.name === topic);
    if (!found) throw new UsageError(`${unknown('command', topic, spec().commands.map((command) => command.name))}\nrun \`zubra --help\` for the commands`);
    return void process.stdout.write(found.help);
  }
  if (name === '-V' || name === '--version') return void console.log(`zubra ${version()}`);
  if (name.startsWith('-')) throw new UsageError(`${unknown('flag', name, ['--help', '--version'])}\nrun \`zubra --help\` for the options`);
  const command = spec().commands.find((candidate) => candidate.name === name);
  if (!command) throw new UsageError(`${unknown('command', name, spec().commands.map((candidate) => candidate.name))}\nrun \`zubra --help\` for the commands`);
  // Help and the version come before anything else the command would do.
  if (args.some(help)) return void process.stdout.write(command.help);
  if (args.some((arg) => arg === '-V' || (arg === '--version' && !command.flags.some((flag) => flag.name === '--version')))) return void console.log(`zubra ${version()}`);
  const parsed = parse(command, args);
  const { flags, rest } = parsed;
  if (['request', 'serve', 'mcp'].includes(name) && name !== 'mcp' && rest.length) throw new UsageError(`\`zubra ${name}\` takes no arguments, and was given \`${rest[0]}\``);
  if (name === 'check') return check(command, parsed);
  if (name === 'compile') return compile(command, parsed);
  if (name === 'convert') return convert(command, parsed);
  if (name === 'fmt') return fmt(command, parsed);
  if (name === 'request') return void process.stdout.write(`${JSON.stringify(answer(readFileSync(0, 'utf8')))}\n`);
  if (name === 'serve') return serveLines();
  if (name === 'mcp') {
    // Standard output is the protocol: anything else goes to standard error.
    const components = loadComponents(rest);
    process.stderr.write(`zubra mcp: ${components.length} component${components.length === 1 ? '' : 's'} (${components.map((c) => c.tag).join(', ')}), on standard input and output\n`);
    return serveMcp(components);
  }
  if (name === 'build' && flags.embed) {
    if (rest.length !== 1 || flags.lib) throw misuse(command, 'zubra build --embed takes one components folder');
    const out = flags.out ?? 'embed';
    const { components } = buildEmbed(rest[0], { out, name: flags.name, base: flags.base });
    console.log(`zubra: embed build of ${components.length} component${components.length === 1 ? '' : 's'} in ${relative(process.cwd(), resolve(out)) || '.'} (see its README.md): ${components.map(({ tag }) => `<${tag}>`).join(' ')}`);
  } else if (name === 'build') {
    if (!flags.lib || rest.length !== 1) throw misuse(command, 'zubra build takes --lib or --embed, and one components folder');
    const out = flags.out ?? 'dist';
    const build = () => {
      const { components, warnings } = buildLibrary(rest[0], { out, name: flags.name, version: flags.version });
      for (const warning of warnings) process.stderr.write(warning);
      console.log(`zubra: built ${components.length} component${components.length === 1 ? '' : 's'} into ${relative(process.cwd(), resolve(out)) || '.'}: ${components.map(({ tag }) => `<${tag}>`).join(' ')}`);
    };
    if (!flags.watch) return build();
    // --watch: build, then again after each change to the components (a compile error is
    // reported and the last good build stays).
    const attempt = () => {
      try {
        build();
      } catch (error) {
        console.error(error.message);
      }
    };
    attempt();
    let timer = null;
    watch(rest[0], { recursive: true }, (_event, file) => {
      if (file && !/\.zb(\.[jt]sx)?$/.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(attempt, 50);
    });
    console.log(`zubra: watching ${rest[0]} (Ctrl+C to stop)`);
  } else if (name === 'add') {
    if (flags.list) {
      for (const component of readRegistry().components) console.log(`${component.name.padEnd(20)} ${component.description}`);
      return;
    }
    if (!rest.length) throw misuse(command, 'missing the components to add (zubra add --list lists them)');
    const files = add(rest, { target: flags.dir ?? 'src/components', force: flags.force });
    console.log(`zubra: added ${files.join(', ')}. They're yours now: edit them as you like.`);
    const packages = packagesFor(files);
    if (packages.length) console.log(`zubra: they import ${packages.join(', ')}: npm install ${packages.join(' ')}`);
  } else if (name === 'types') {
    const dir = flags.dir ?? '.zubra/types';
    const { framework, files, errors } = writeTypes(rest, { dir, framework: flags.framework });
    for (const error of errors) process.stderr.write(error);
    if (errors.length) process.exitCode = 1;
    if (!files.length && !errors.length) throw new Error(`zubra types: no .zb components in ${rest.length ? rest.join(', ') : 'this folder'}`);
    console.log(`zubra: typings of ${files.length} component${files.length === 1 ? '' : 's'} in ${relative(process.cwd(), resolve(dir)) || '.'}, for ${framework === 'none' ? 'the elements' : framework}`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const running = main(process.argv.slice(2));
    if (running instanceof Promise) running.catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error.message.replace(/\n$/, ''));
    process.exitCode = error instanceof UsageError ? 2 : 1;
  }
}
