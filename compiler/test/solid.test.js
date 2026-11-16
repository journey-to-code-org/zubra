// Typings for Solid 1 and Solid 2, checked by TypeScript against Solid 2's own JSX types (the
// devDependencies solid-js and @solidjs/web, 2.0.0-rc.22), and the CLI choosing between them by
// the version an app has.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFile } from '../index.js';
import { solidOf } from '../solid.js';

const here = dirname(fileURLToPath(import.meta.url));
const component = join(here, '..', '..', 'registry', 'components', 'choice-cards.zb');
const tsc = join(here, '..', 'node_modules', '.bin', 'tsc');

// A Solid 2 app's use of <choice-cards>: what must type-check, and what must not.
const APP = `import type ChoiceCards from './choice-cards.zb';
export const ok = (
  <choice-cards
    value="a"
    prop:items={[{ id: 'a', title: 'A' }]}
    label="Plan"
    onvaluechange={(event) => { const id: string = event.detail; console.log(id); }}
    ref={(el: ChoiceCards) => el.updateComplete}
  />
);
// @ts-expect-error Solid 1's spelling: Solid 2 listens for ":valuechange", which never fires.
export const old = <choice-cards on:valuechange={(event: CustomEvent<string>) => console.log(event)} />;
// @ts-expect-error a prop of the wrong type.
export const wrong = <choice-cards required="yes" />;
// @ts-expect-error the event's detail is a string.
export const detail = <choice-cards onvaluechange={(event) => { const n: number = event.detail; console.log(n); }} />;
`;

/** Type-checks APP against `framework`'s typings of <choice-cards>, in a folder here (so
 * TypeScript finds this package's solid-js and @solidjs/web). */
function check(framework) {
  const output = compileFile(component, { emit: 'dts', framework });
  assert.ok(output.ok, output.error);
  const dir = join(here, `.solid-${framework}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);
  try {
    writeFileSync(join(dir, 'choice-cards.d.zb.ts'), output.output);
    writeFileSync(join(dir, 'app.tsx'), APP);
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, jsx: 'preserve', jsxImportSource: '@solidjs/web', module: 'esnext', moduleResolution: 'bundler', target: 'es2022', noEmit: true, skipLibCheck: true, allowArbitraryExtensions: true, types: [] },
      files: ['app.tsx', 'choice-cards.d.zb.ts'],
    }));
    const run = spawnSync(tsc, ['-p', dir], { encoding: 'utf8' });
    return { status: run.status, output: run.stdout + run.stderr, dts: output.output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Solid 2: the element in @solidjs/web/jsx-runtime\'s JSX, events as onvaluechange; misuse is a type error', () => {
  const { status, output, dts } = check('solid2');
  assert.match(dts, /import type \{ JSX \} from "@solidjs\/web";/);
  assert.match(dts, /declare module "@solidjs\/web\/jsx-runtime" \{/);
  assert.match(dts, /"onvaluechange"\?: \(event: ChoiceCardsEventMap\["valuechange"\]\) => void/);
  assert.doesNotMatch(dts, /"on:valuechange"/);
  assert.equal(status, 0, output);
});

test('Solid 1\'s typings under Solid 2 don\'t declare the element at all: why there are two', () => {
  const { status, output } = check('solid');
  assert.notEqual(status, 0);
  assert.match(output, /Property 'choice-cards' does not exist on type 'JSX\.IntrinsicElements'/);
});

test('which Solid an app has: the installed solid-js (here or above), else its package.json', () => {
  const app = mkdtempSync(join(tmpdir(), 'zb-solid-'));
  try {
    const manifest = (range) => writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { 'solid-js': range } }));
    const installed = (folder, version) => {
      mkdirSync(join(folder, 'node_modules', 'solid-js'), { recursive: true });
      writeFileSync(join(folder, 'node_modules', 'solid-js', 'package.json'), JSON.stringify({ name: 'solid-js', version }));
    };
    manifest('^1.9.0');
    assert.equal(solidOf(app), 'solid');
    manifest('2.0.0-rc.22');
    assert.equal(solidOf(app), 'solid2');
    manifest('^2.0.0');
    assert.equal(solidOf(app), 'solid2');
    // What's installed wins over the range; a workspace's hoisted copy counts.
    const nested = join(app, 'packages', 'web');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'package.json'), JSON.stringify({ dependencies: { 'solid-js': '*' } }));
    installed(app, '1.9.19');
    assert.equal(solidOf(app), 'solid');
    assert.equal(solidOf(nested), 'solid');
    installed(nested, '2.0.0-rc.22');
    assert.equal(solidOf(nested), 'solid2');
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});

test('the build plugin chooses the same way: its solid.js is this one', () => {
  // @zubra/unplugin has no dependencies, so it keeps a copy; the copies differ only in the comment above.
  const body = (file) => readFileSync(file, 'utf8').replace(/^(\/\/.*\n)+/, '');
  assert.equal(body(join(here, '..', '..', 'plugin', 'src', 'solid.js')), body(join(here, '..', 'solid.js')));
});
