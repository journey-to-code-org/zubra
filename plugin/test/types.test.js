// The package's own typings: a TypeScript config file imports each bundler entry by its package
// name, as an app does, and TypeScript checks the options. Needs only TypeScript.
// `npm test` in plugin/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsc = join(dirname(require.resolve('typescript/package.json')), 'bin', 'tsc');

/** Type-check `files` in a project inside plugin/, where `@zubra/unplugin` resolves to this package. */
function typecheck(name, files) {
  const root = join(here, '.tmp', `types-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  for (const [file, source] of Object.entries(files)) writeFileSync(join(root, file), source);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true, noEmit: true, module: 'nodenext', moduleResolution: 'nodenext', target: 'es2022',
      lib: ['es2022', 'dom'], skipLibCheck: true, types: [],
    },
    files: Object.keys(files),
  }));
  const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json')], { encoding: 'utf8', cwd: root });
  return (result.stdout + result.stderr).split('\n').filter((line) => /error TS\d+/.test(line));
}

test('every bundler entry has typings, and a Vite config type-checks with options', () => {
  const errors = typecheck('ok', {
    'vite.config.mts': `
      import { defineConfig } from 'vite';
      import zubra from '@zubra/unplugin/vite';
      export default defineConfig({ plugins: [zubra(), zubra({ framework: 'react', dts: false, ssr: false, devtools: true }), zubra({ dts: { dir: '.zubra/types' } })] });
    `,
    'others.mts': `
      import rollup from '@zubra/unplugin/rollup';
      import webpack from '@zubra/unplugin/webpack';
      import esbuild from '@zubra/unplugin/esbuild';
      import rspack from '@zubra/unplugin/rspack';
      import astro from '@zubra/unplugin/astro';
      import unplugin, { isLightDom, variantFor } from '@zubra/unplugin';
      export const plugins = [rollup(), webpack({ runtime: '@zubra/runtime' }), esbuild(), rspack(), astro({ framework: 'element' })];
      export const name: string = rollup().name;
      export const light: boolean = isLightDom('<x-y></x-y>');
      export const variant: 'element' | 'react' | 'vue' = variantFor('', 'App.tsx', 'react');
      export const vite = unplugin.vite;
    `,
  });
  assert.deepEqual(errors, []);
});

/** An app as the README sets it up, inside plugin/, where `@zubra/unplugin` resolves to this package. */
function appProject(name, files) {
  const root = join(here, '.tmp', `dts-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'node_modules', '@zubra'), { recursive: true });
  symlinkSync(join(here, '..'), join(root, 'node_modules', '@zubra', 'unplugin'), 'dir');
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), source);
  }
  return root;
}

/** The app's `tsc -p`, with its errors (or none). */
function checkApp(root) {
  const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'app', 'tsconfig.json')], { encoding: 'utf8', cwd: root });
  return (result.stdout + result.stderr).split('\n').filter((line) => /error TS\d+/.test(line));
}

/** An app's tsconfig: the typings folder's mapping first, then the real source, as the README has it. */
function appConfig(paths) {
  return JSON.stringify({
    compilerOptions: {
      module: 'esnext', moduleResolution: 'bundler', strict: true, noEmit: true,
      allowArbitraryExtensions: true, types: ['@zubra/unplugin/client'],
      paths: { '@ui/*': paths },
    },
    include: ['src'],
  });
}
const ui = ['./.zubra/types/__/ui/*', '../ui/*'];
const main = "import Badge from '@ui/src/status-badge.zb';\nexport const badge: number = Badge;\n";

test('a fresh checkout: an aliased .zb import type-checks before the first build', () => {
  const root = appProject('fresh', {
    'app/tsconfig.json': appConfig(ui),
    'app/src/main.ts': "import Badge from '@ui/src/status-badge.zb';\nexport const badge = Badge;\n",
    'ui/src/status-badge.zb': '<status-badge></status-badge>\n',
  });
  assert.deepEqual(checkApp(root), []);
});

test('with typings, an aliased .zb import is typed by the typings folder', () => {
  const root = appProject('typed', {
    'app/tsconfig.json': appConfig(ui),
    'app/src/main.ts': main,
    'app/.zubra/types/__/ui/src/status-badge.d.zb.ts': 'declare const Badge: { variant: string };\nexport default Badge;\n',
    'ui/src/status-badge.zb': '<status-badge></status-badge>\n',
  });
  const errors = checkApp(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], /\{ variant: string; \}/);
});

test('a typings file beside a component is read first when the source path is listed first', () => {
  const files = {
    'app/src/main.ts': main,
    'app/.zubra/types/__/ui/src/status-badge.d.zb.ts': 'declare const Badge: { variant: string };\nexport default Badge;\n',
    'ui/src/status-badge.zb': '<status-badge></status-badge>\n',
    'ui/src/status-badge.d.zb.ts': 'declare const Badge: { size: number };\nexport default Badge;\n',
  };
  const inOrder = checkApp(appProject('order-ok', { ...files, 'app/tsconfig.json': appConfig(ui) }));
  assert.match(inOrder.join('\n'), /\{ variant: string; \}/, 'the typings folder first: the app reads its own typings');
  const reversed = checkApp(appProject('order-bad', { ...files, 'app/tsconfig.json': appConfig([...ui].reverse()) }));
  assert.match(reversed.join('\n'), /\{ size: number; \}/, 'the source first: the typings beside the component hide the folder');
});

test('a wrong option is a type error', () => {
  const errors = typecheck('bad', {
    'vite.config.mts': `
      import zubra from '@zubra/unplugin/vite';
      export const a = zubra({ framework: 'svelte' });
      export const b = zubra({ dts: 'yes' });
      export const c = zubra({ compilr: 'zubra' });
    `,
  });
  assert.equal(errors.length, 3, errors.join('\n'));
  assert.match(errors[0], /'"svelte"' is not assignable/);
  assert.match(errors[1], /'string' is not assignable to type 'boolean \| \{ dir: string; \} \| undefined'/);
  assert.match(errors[2], /'compilr' does not exist/);
});
