// `zubra` from npm: `add` (the registry) and `build --lib`, through the command line.
// Uses zubra.wasm when built; otherwise the CLI in target/debug (cargo build).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { add, readRegistry } from '../cli.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const cli = join(here, '../cli.js');
const env = { ...process.env, ZUBRA_COMPILER: process.env.ZUBRA_COMPILER ?? join(repo, 'target/debug/zubra') };
const zubra = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, env, encoding: 'utf8' });

test('the registry lists 26 components, each with a description, category and files', () => {
  const { components } = readRegistry();
  assert.equal(components.length, 26);
  for (const component of components) {
    assert.ok(component.description.length > 20, component.name);
    assert.ok(['input', 'display', 'app', 'widget'].includes(component.category), component.name);
    assert.deepEqual(component.files, [`${component.name}.zb`]);
  }
  const index = spawnSync(process.execPath, [join(repo, 'registry/build-index.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(index.status, 0, index.stderr);
});

test('zubra add copies components in, never over your edits without --force, and suggests names', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-add-'));
  let run = zubra(['add', 'tag-input', 'modal-dialog'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /added src\/components\/tag-input\.zb, src\/components\/modal-dialog\.zb/);
  assert.equal(readFileSync(join(dir, 'src/components/tag-input.zb'), 'utf8'), readFileSync(join(repo, 'registry/components/tag-input.zb'), 'utf8'));

  writeFileSync(join(dir, 'src/components/tag-input.zb'), '<!-- mine -->');
  run = zubra(['add', 'tag-input'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /already exists \(--force replaces it\)/);
  assert.equal(readFileSync(join(dir, 'src/components/tag-input.zb'), 'utf8'), '<!-- mine -->');
  assert.equal(zubra(['add', 'tag-input', '--force'], dir).status, 0);

  run = zubra(['add', 'stepper-quantity'], dir);
  assert.match(run.stderr, /no component "stepper-quantity"/);
  assert.match(zubra(['add', 'toggle-swich'], dir).stderr, /did you mean toggle-switch\?/);
  assert.match(zubra(['add', '--list'], dir).stdout, /^chat-message +One message/m);
  // Into another directory, through the API.
  assert.deepEqual(add(['star-rating'], { target: join(dir, 'ui') }), [join(dir, 'ui/star-rating.zb')]);
  // A component that imports npm packages says which to install.
  run = zubra(['add', 'combo-box', 'tab-list'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /they import @zag-js\/vanilla, @zag-js\/combobox: npm install @zag-js\/vanilla @zag-js\/combobox/);
  assert.doesNotMatch(zubra(['add', 'accordion-panel'], dir).stdout, /npm install/);
});

test('zubra build --lib and zubra check, from the command line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-lib-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@acme/widgets', version: '0.3.0', license: 'MIT' }));
  execFileSync(process.execPath, [cli, 'add', 'quantity-stepper', 'toggle-switch'], { cwd: dir, env });
  let run = zubra(['build', '--lib', 'src/components'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /built 2 components into dist: <quantity-stepper> <toggle-switch>/);
  const pkg = JSON.parse(readFileSync(join(dir, 'dist/package.json'), 'utf8'));
  assert.deepEqual([pkg.name, pkg.version, pkg.license], ['@acme/widgets', '0.3.0', 'MIT']);
  assert.ok(existsSync(join(dir, 'dist/react/toggle-switch.d.ts')));
  // A skill for coding agents, from the manifest: every component, its props, events and slots.
  const skill = readFileSync(join(dir, 'dist/skills/using-acme-widgets/SKILL.md'), 'utf8');
  assert.match(skill, /^---\nname: using-acme-widgets\ndescription: Use the @acme\/widgets web components \(<quantity-stepper>, <toggle-switch>\)/);
  assert.match(skill, /### `<toggle-switch>`[\s\S]*\| `checked` \| `boolean` \| `false` \| two-way: fires `checkedchange` \|/);
  assert.match(skill, /Import `@acme\/widgets\/quantity-stepper`/);

  run = zubra(['check', 'src/components/quantity-stepper.zb'], dir);
  assert.match(run.stderr, /checked 1 file: no errors/);
  // A folder is every component under it (and not node_modules, or a file that isn't one).
  mkdirSync(join(dir, 'src/components/node_modules/pkg'), { recursive: true });
  writeFileSync(join(dir, 'src/components/node_modules/pkg/theirs.zb'), '<x-theirs><p>{nope(</p></x-theirs>');
  writeFileSync(join(dir, 'src/components/notes.js'), 'export const notes = [];');
  writeFileSync(join(dir, 'src/components/x-framed.zb.jsx'), "export default function XFramed({ label = 'x' }) {\n  return <p>{label}</p>;\n}\n");
  run = zubra(['check', 'src'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /checked 3 files: no errors/);
  rmSync(join(dir, 'src/components/x-framed.zb.jsx'));
  rmSync(join(dir, 'src/components/node_modules'), { recursive: true });
  mkdirSync(join(dir, 'empty'));
  run = zubra(['check', 'empty'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /empty: no components \(\.zb, \.zb\.jsx, \.zb\.tsx\) in this folder/);
  writeFileSync(join(dir, 'src/components/broken.zb'), '<x-broken><p>{nope(</p></x-broken>');
  run = zubra(['build', '--lib', 'src/components'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /broken\.zb:1:/);
  run = zubra(['compile', 'src/components/toggle-switch.zb', '--emit', 'js'], dir);
  assert.match(run.stdout, /\$define\(tag/);
});

test('zubra convert: a React component becomes a zubra JSX component next to it; what is left is reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-convert-'));
  writeFileSync(join(dir, 'Toggle.jsx'), "import { useState } from 'react';\n\nexport default function Toggle({ label = 'On' }) {\n  const [on, setOn] = useState(false);\n  return <button aria-pressed={on} onClick={() => setOn(!on)}>{label}</button>;\n}\n");
  let run = zubra(['convert', 'Toggle.jsx', '--prefix', 'ui'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /wrote ui-toggle\.zb\.jsx \(<ui-toggle>\)/);
  const out = readFileSync(join(dir, 'ui-toggle.zb.jsx'), 'utf8');
  assert.match(out, /export default function UiToggle\(\{ label = 'On' \}\) \{\n {2}let on = false;/);
  assert.match(out, /onClick=\{\(\) => \(on = !on\)\}/);
  assert.equal(zubra(['check', 'ui-toggle.zb.jsx'], dir).status, 0);

  writeFileSync(join(dir, 'Menu.jsx'), "import { useContext } from 'react';\nexport default function UserMenu() {\n  const theme = useContext(Theme);\n  return <nav />;\n}\n");
  run = zubra(['convert', 'Menu.jsx', '--stdout'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /`useContext` became `inject\(\)`, but its context comes from elsewhere/);
  assert.match(run.stderr, /1 thing to finish by hand/);
});

test('zubra build --lib --watch rebuilds on a change, and keeps the last good build through an error', async () => {
  const { spawn } = await import('node:child_process');
  const { mkdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'zb-watch-'));
  mkdirSync(join(dir, 'components'));
  const component = join(dir, 'components/hello-tag.zb');
  writeFileSync(component, '<hello-tag name="you"><p>Hello {name}</p></hello-tag>\n');
  const child = spawn(process.execPath, [cli, 'build', '--lib', 'components', '--out', 'ui', '--watch'], { cwd: dir, env });
  let output = '';
  child.stdout.on('data', (data) => (output += data));
  child.stderr.on('data', (data) => (output += data));
  const until = async (test) => {
    for (let tries = 0; tries < 100 && !test(); tries++) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(test(), output);
  };
  try {
    await until(() => /watching/.test(output));
    const built = () => readFileSync(join(dir, 'ui/hello-tag.js'), 'utf8');
    assert.match(built(), /Hello /);
    writeFileSync(component, '<hello-tag name="you"><p>Howdy {name}</p></hello-tag>\n');
    await until(() => existsSync(join(dir, 'ui/hello-tag.js')) && /Howdy/.test(built()));
    output = '';
    writeFileSync(component, '<hello-tag name="you"><p>{nope}</p></hello-tag>\n');
    await until(() => /nope/.test(output));
    assert.match(built(), /Howdy/, 'the last good build is still there');
    assert.equal(existsSync(join(dir, 'ui.building')), false);
  } finally {
    child.kill();
  }
});

test('zubra fmt formats in place, checks, and reads standard input', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-fmt-'));
  const messy = '<x-a>\n<p>a</p>\n</x-a>\n';
  const tidy = '<x-a>\n  <p>a</p>\n</x-a>\n';
  writeFileSync(join(dir, 'a.zb'), messy);
  writeFileSync(join(dir, 'b.zb'), tidy);

  let result = zubra(['fmt', '.', '--check'], dir);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /would format a\.zb/);
  assert.doesNotMatch(result.stdout, /b\.zb/);
  assert.match(result.stderr, /1 file is not formatted/);
  assert.equal(readFileSync(join(dir, 'a.zb'), 'utf8'), messy);

  result = zubra(['fmt', '.'], dir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(dir, 'a.zb'), 'utf8'), tidy);
  assert.equal(zubra(['fmt', '.', '--check'], dir).status, 0);

  result = spawnSync(process.execPath, [cli, 'fmt', '--stdin', '--tabs'], { cwd: dir, env, encoding: 'utf8', input: messy });
  assert.equal(result.stdout, '<x-a>\n\t<p>a</p>\n</x-a>\n');
  result = spawnSync(process.execPath, [cli, 'fmt', '--stdin'], { cwd: dir, env, encoding: 'utf8', input: '<x-a>\n<p>\n</x-a>\n' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /closing tag/);
});

test('zubra types writes the typings a build with dts: { dir } writes, for the app\'s framework', () => {
  const work = mkdtempSync(join(tmpdir(), 'zb-types-'));
  const app = join(work, 'apps/web');
  mkdirSync(join(app, 'src'), { recursive: true });
  mkdirSync(join(work, 'ui'));
  const rating = join(repo, 'runtime/test/browser/fixtures/rating.zb');
  cpSync(rating, join(app, 'src/own.zb'));
  cpSync(rating, join(work, 'ui/rating.zb'));
  mkdirSync(join(app, 'node_modules/pkg'), { recursive: true });
  cpSync(rating, join(app, 'node_modules/pkg/skipped.zb'));
  const read = (file) => readFileSync(join(app, file), 'utf8');
  const config = () => JSON.parse(read('.zubra/types/tsconfig.json')).compilerOptions;

  // No package.json: the elements. The folder mirrors the app, and nothing is beside a component.
  let run = zubra(['types'], app);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /typings of 1 component in \.zubra\/types, for the elements/);
  assert.match(read('.zubra/types/src/own.d.zb.ts'), /export declare class ZbRating extends HTMLElement/);
  assert.doesNotMatch(read('.zubra/types/src/own.d.zb.ts'), /from "react"/);
  assert.equal(existsSync(join(app, 'src/own.d.zb.ts')), false);
  assert.equal(existsSync(join(app, '.zubra/types/node_modules')), false);
  assert.deepEqual(config(), { allowArbitraryExtensions: true, rootDirs: ['../..', '.'] });

  // The framework is the one the app depends on; a folder above the app goes under `__`.
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' }, devDependencies: { typescript: '^6.0.0' } }));
  run = zubra(['types', '.', '../../ui'], app);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /typings of 2 components in \.zubra\/types, for react/);
  assert.match(read('.zubra/types/src/own.d.zb.ts'), /from "react"/);
  assert.match(read('.zubra/types/__/__/ui/rating.d.zb.ts'), /from "react"/);
  assert.deepEqual(config().rootDirs, ['../..', '.', '../../..', '__', '../../../..', '__/__']);
  // The list only grows: typing fewer folders keeps the ones it had.
  assert.equal(zubra(['types', 'src'], app).status, 0);
  assert.equal(config().rootDirs.length, 6);

  // --framework and --dir say otherwise.
  run = zubra(['types', 'src', '--framework', 'vue', '--dir', 'types/vue'], app);
  assert.match(run.stdout, /typings of 1 component in types\/vue, for vue/);
  assert.match(read('types/vue/src/own.d.zb.ts'), /from "vue"/);
  run = zubra(['types', 'src', '--framework', 'angular'], app);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown --framework value `angular`; expected react, vue, svelte, solid, solid2, vanilla/);
  // No framework is `vanilla`, and its other names still work.
  for (const name of ['vanilla', 'none', 'element', 'plain']) {
    run = zubra(['types', 'src', '--framework', name, '--dir', `types/${name}`], app);
    assert.match(run.stdout, /for the elements/, name);
  }

  // Two frameworks: it asks. A component that doesn't compile: reported, the rest still written.
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0', 'solid-js': '^1.9.0' } }));
  run = zubra(['types'], app);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /depends on react and solid: say which the typings are for with --framework react\|solid/);
  writeFileSync(join(app, 'src/broken.zb'), '<x-broken><p>{nope(</p></x-broken>');
  run = zubra(['types', 'src', '--framework', 'solid', '--dir', 'types/solid'], app);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /broken\.zb:1:/);
  assert.match(read('types/solid/src/own.d.zb.ts'), /solid-js/);
  // Solid 2, by the version the app asks for (or has installed): its JSX is @solidjs/web's.
  rmSync(join(app, 'src/broken.zb'));
  writeFileSync(join(app, 'package.json'), JSON.stringify({ dependencies: { 'solid-js': '^2.0.0', '@solidjs/web': '^2.0.0' } }));
  run = zubra(['types', 'src', '--dir', 'types/solid2'], app);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /typings of 1 component in types\/solid2, for solid2/);
  assert.match(read('types/solid2/src/own.d.zb.ts'), /declare module "@solidjs\/web\/jsx-runtime"/);
  run = zubra(['types', 'nowhere', '--framework', 'none'], app);
  assert.match(run.stderr, /nowhere doesn't exist/);
});

const native = env.ZUBRA_COMPILER;
const nativeRuns = existsSync(native);
const nativeRun = (args, cwd) => spawnSync(native, args, { cwd, env, encoding: 'utf8' });

test('help and the version come before anything else, from both CLIs alike', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-help-'));
  let run = zubra(['--help'], dir);
  assert.equal(run.status, 0);
  const help = run.stdout;
  assert.match(help, /--emit html\|js\|element\|css\|dts\|manifest\|html-data\|interface\|server\|tsx/);
  assert.match(help, /--framework react\|vue\|svelte\|solid\|solid2\|vanilla/);
  assert.match(help, /\[--client-only\]/);
  assert.match(help, /Exit codes: 0 success \(warnings included\), 1 errors in the input, 2 a usage error\./);
  for (const command of ['check', 'compile', 'convert', 'fmt', 'request', 'serve', 'build', 'add', 'types', 'mcp']) {
    run = zubra([command, '--help'], dir);
    assert.equal(run.status, 0, `${command}: ${run.stderr}`);
    assert.match(run.stdout, new RegExp(`^usage: zubra ${command}`, 'm'));
    assert.equal(zubra([command, '-h'], dir).stdout, run.stdout);
    // The same text the native CLI prints.
    if (nativeRuns) assert.equal(nativeRun([command, '--help'], dir).stdout, run.stdout, command);
  }
  if (nativeRuns) assert.equal(nativeRun(['--help'], dir).stdout, help);
  // --help never does the command's work: no typings written, no server started.
  assert.equal(zubra(['types', '--help'], dir).status, 0);
  assert.equal(existsSync(join(dir, '.zubra')), false);
  assert.equal(spawnSync(process.execPath, [cli, 'mcp', '--help'], { cwd: dir, env, encoding: 'utf8', timeout: 5000 }).status, 0);
  const { version } = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8'));
  for (const args of [['--version'], ['-V'], ['check', '--version'], ['types', '-V']]) {
    assert.deepEqual([zubra(args, dir).status, zubra(args, dir).stdout], [0, `zubra ${version}\n`], args.join(' '));
  }
  // `build --lib --version` is the package's version, not this one.
  assert.doesNotMatch(zubra(['build', '--version'], dir).stdout, /^zubra /);
});

test('usage errors exit 2 with what was meant; errors in the input exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-usage-'));
  let run = zubra(['chek', 'x.zb'], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^unknown command `chek`; did you mean `check`\?\nrun `zubra --help` for the commands/);
  run = zubra(['check', '--formt', 'json', 'x.zb'], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^unknown flag `--formt`; did you mean `--format`\?/);
  run = zubra(['compile', 'x.zb', '--emit', 'jss'], dir);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /did you mean `js`\?/);
  assert.equal(zubra(['check'], dir).status, 2);
  assert.equal(zubra([], dir).status, 2);
  // The same messages from the native CLI.
  if (nativeRuns) {
    for (const args of [['chek', 'x.zb'], ['check', '--formt', 'json', 'x.zb'], ['compile', 'x.zb', '--emit', 'jss'], ['check']]) {
      const ours = zubra(args, dir);
      const theirs = nativeRun(args, dir);
      assert.deepEqual([theirs.status, theirs.stderr], [ours.status, ours.stderr], args.join(' '));
    }
  }
  run = zubra(['check', 'missing.zb'], dir);
  assert.deepEqual([run.status, run.stderr], [1, 'no such file: missing.zb\n']);
  run = zubra(['compile', 'missing.zb'], dir);
  assert.deepEqual([run.status, run.stderr], [1, 'no such file: missing.zb\n']);
});

test('check takes --format json, --deny-warnings and --stdin as the native CLI does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-check-'));
  writeFileSync(join(dir, 'x-warned.zb'), '<x-warned hidden={false}><p>{hidden}</p></x-warned>');
  writeFileSync(join(dir, 'x-broken.zb'), '<x-broken><p>{nope}</p></x-broken>');
  writeFileSync(join(dir, 'x-typed.zb'), '<script lang="ts">\n  let n: number = 1\n</script>\n<x-typed><p>{n}</p></x-typed>');
  let run = zubra(['check', 'x-broken.zb', 'x-warned.zb', '--format', 'json'], dir);
  assert.equal(run.status, 1);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.map(({ file, code, severity }) => [file, code, severity]), [['x-broken.zb', 'ZB2001', 'error'], ['x-warned.zb', 'ZB4019', 'warning']]);
  if (nativeRuns) assert.deepEqual(JSON.parse(nativeRun(['check', 'x-broken.zb', 'x-warned.zb', '--format', 'json'], dir).stdout), report);
  run = zubra(['check', 'x-broken.zb'], dir);
  assert.match(run.stderr, /^error\[ZB2001\]: unknown reference `nope`/);
  run = zubra(['check', 'x-warned.zb'], dir);
  assert.equal(run.status, 0, run.stderr);
  run = zubra(['check', 'x-warned.zb', '--deny-warnings'], dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /1 warning \(--deny-warnings\)\n$/);
  run = spawnSync(process.execPath, [cli, 'check', '--stdin', 'x-warned.zb'], { cwd: dir, env, encoding: 'utf8', input: '<x-warned><p>{nope}</p></x-warned>' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /unknown reference `nope`/);
  run = zubra(['check', 'x-typed.zb'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /no errors\nTypeScript types weren't checked: add --types\n$/);
});

test('compile takes every flag the native CLI takes, and request and serve answer JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-compile-'));
  writeFileSync(join(dir, 'x-plain.zb'), '<x-plain label="hi"><p>{label}</p></x-plain>');
  const same = (args) => {
    const run = zubra(args, dir);
    assert.equal(run.status, 0, `${args.join(' ')}: ${run.stderr}`);
    if (nativeRuns) assert.equal(nativeRun(args, dir).stdout, run.stdout, args.join(' '));
    return run.stdout;
  };
  for (const emit of ['html', 'js', 'element', 'css', 'dts', 'manifest', 'html-data', 'interface', 'server', 'tsx']) same(['compile', 'x-plain.zb', '--emit', emit]);
  const vanilla = same(['compile', 'x-plain.zb', '--emit', 'dts', '--framework', 'vanilla']);
  for (const alias of ['element', 'none', 'plain']) assert.equal(same(['compile', 'x-plain.zb', '--emit', 'dts', '--framework', alias]), vanilla);
  same(['compile', 'x-plain.zb', '--emit', 'js', '--client-only', '--keep-imports', '--binder-entries', '--runtime', '/rt.js']);
  same(['compile', 'x-plain.zb', '--emit', 'manifest', '--module-path', 'lib/x.js']);
  writeFileSync(join(dir, 'props.json'), '{"label":"there"}');
  assert.match(same(['compile', 'x-plain.zb', '--props', 'props.json']), /there/);
  assert.equal(zubra(['compile', 'x-plain.zb', '--emit', 'js', '--props', 'props.json'], dir).status, 2);

  const body = JSON.stringify({ command: 'compile', emit: 'html', path: '/x.zb', files: { '/x.zb': '<x-a n="1"><b>{n}</b></x-a>' } });
  let run = spawnSync(process.execPath, [cli, 'request'], { cwd: dir, env, encoding: 'utf8', input: body });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).ok, true);
  run = spawnSync(process.execPath, [cli, 'serve'], { cwd: dir, env, encoding: 'utf8', input: `${body}\nnot json\n` });
  const lines = run.stdout.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => line.ok), [true, false]);
  assert.match(lines[1].error, /isn't JSON/);
});

test('convert takes --component', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zb-convert-one-'));
  writeFileSync(join(dir, 'Both.jsx'), 'export function ItemOne() {\n  return <p>one</p>;\n}\nexport function ItemTwo() {\n  return <p>two</p>;\n}\n');
  assert.equal(zubra(['convert', 'Both.jsx', '--stdout'], dir).status, 1);
  const run = zubra(['convert', 'Both.jsx', '--component', 'ItemTwo', '--stdout'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /two/);
});
