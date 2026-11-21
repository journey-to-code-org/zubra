// Every package carries the release's version, and the packages that need the compiler and the
// runtime ask for this release or later (`^<major>.<minor>.0`, or `^<version>` for a prerelease),
// so npm installs them together.
// `scripts/bump-version.sh` keeps both true.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const json = (path) => JSON.parse(readFileSync(join(repo, path), 'utf8'));
const version = json('runtime/package.json').version;
const prerelease = version.includes('-');
const range = prerelease ? `^${version}` : `^${version.replace(/^(\d+\.\d+)\..*/, '$1.0')}`;

test('every package has the release version', () => {
  for (const path of ['compiler', 'create', 'plugin', 'runtime', 'server', 'actions', 'sync', 'router', 'prettier-plugin', 'editors/language-server', 'editors/vscode', 'editors/devtools']) {
    // A prerelease leaves the VS Code extension on the last release: the Marketplace takes only numbers.
    if (prerelease && (path === 'editors/vscode' || path === 'editors/devtools')) assert.match(json(`${path}/package.json`).version, /^\d+\.\d+\.\d+$/, path);
    else assert.equal(json(`${path}/package.json`).version, version, path);
  }
  assert.match(readFileSync(join(repo, 'Cargo.toml'), 'utf8'), new RegExp(`^version = "${version.replaceAll('.', '\\.')}"$`, 'm'));
  for (const path of ['editors/language-server', 'editors/vscode']) {
    const lock = json(`${path}/package-lock.json`);
    const expected = json(`${path}/package.json`).version;
    assert.equal(lock.version, expected, `${path} lockfile`);
    assert.equal(lock.packages[''].version, expected, `${path} lockfile root`);
  }
  assert.equal(json('editors/vscode/package-lock.json').packages['../language-server'].version, version, 'linked language server');
  assert.equal(json('editors/devtools/manifest.json').version, json('editors/devtools/package.json').version);
});

test('packages ask for this release of the Zubra packages they use', () => {
  for (const [path, names] of Object.entries({
    plugin: ['@zubra/compiler', '@zubra/runtime'],
    server: ['@zubra/compiler', '@zubra/runtime'],
    actions: ['@zubra/compiler', '@zubra/server'],
    sync: ['@zubra/runtime'],
    router: ['@zubra/compiler', '@zubra/server'],
  })) {
    const pkg = json(`${path}/package.json`);
    const wanted = { ...pkg.peerDependencies, ...pkg.dependencies };
    const root = json(`${path}/package-lock.json`).packages[''];
    const locked = { ...root.peerDependencies, ...root.dependencies };
    for (const name of names) {
      assert.equal(wanted[name], range, `${path}: ${name}`);
      assert.equal(locked[name], range, `${path} lockfile: ${name}`);
    }
  }
});

test('the compiler asks for a runtime no older than itself, only where one is installed', () => {
  // Compiled output is for its compiler's release; a runtime runs older compilers' output, never
  // a later one's. With this, npm refuses the pair that starts no element (#324), and still
  // installs the compiler alone.
  const pkg = json('compiler/package.json');
  assert.deepEqual(pkg.peerDependencies, { '@zubra/runtime': `>=${version}` });
  assert.deepEqual(pkg.peerDependenciesMeta, { '@zubra/runtime': { optional: true } });
  const root = json('compiler/package-lock.json').packages[''];
  assert.deepEqual([root.peerDependencies, root.peerDependenciesMeta], [pkg.peerDependencies, pkg.peerDependenciesMeta], 'the lockfile says the same');
});

test('scripts/bump-version.sh moves that range with the version', () => {
  // The script edits files by path from where it runs: run it on copies of the two it must change here.
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bump-'));
  try {
    const script = readFileSync(join(repo, 'scripts/bump-version.sh'), 'utf8');
    const block = script.slice(script.indexOf('for f in compiler/package.json compiler/package-lock.json; do'), script.indexOf('echo "version $v"'));
    assert.match(block, /@zubra\/runtime/);
    mkdirSync(join(dir, 'compiler'));
    for (const file of ['compiler/package.json', 'compiler/package-lock.json']) cpSync(join(repo, file), join(dir, file));
    execFileSync('sh', ['-c', `set -e; v=9.8.7; V='[0-9][0-9A-Za-z.-]*'; ${block}`], { cwd: dir });
    for (const file of ['compiler/package.json', 'compiler/package-lock.json']) {
      const text = readFileSync(join(dir, file), 'utf8');
      assert.equal(text.match(/"@zubra\/runtime": ">=([0-9A-Za-z.-]+)"/)?.[1], '9.8.7', file);
      JSON.parse(text);
    }
    // And on from a prerelease to the release after it.
    execFileSync('sh', ['-c', `set -e; v=9.8.8-rc.0; V='[0-9][0-9A-Za-z.-]*'; ${block}`], { cwd: dir });
    execFileSync('sh', ['-c', `set -e; v=9.8.8; V='[0-9][0-9A-Za-z.-]*'; ${block}`], { cwd: dir });
    assert.equal(readFileSync(join(dir, 'compiler/package.json'), 'utf8').match(/"@zubra\/runtime": ">=([0-9A-Za-z.-]+)"/)?.[1], '9.8.8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('version bumps keep editor lockfiles in step, including prereleases', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-bump-editors-'));
  try {
    const script = readFileSync(join(repo, 'scripts/bump-version.sh'), 'utf8');
    const start = script.indexOf('for f in compiler/package-lock.json');
    const end = script.indexOf('# sync installs', start);
    assert.ok(start !== -1 && end !== -1);
    const block = script.slice(start, end);
    for (const path of ['compiler', 'plugin', 'runtime', 'server', 'actions', 'sync', 'router', 'prettier-plugin', 'editors/language-server', 'editors/vscode']) {
      mkdirSync(join(dir, path), { recursive: true });
      cpSync(join(repo, path, 'package-lock.json'), join(dir, path, 'package-lock.json'));
    }
    const bump = (version) => execFileSync('sh', ['-c', `set -e; v=${version}; V='[0-9][0-9A-Za-z.-]*'; ${block}`], { cwd: dir });
    const lock = (path) => JSON.parse(readFileSync(join(dir, path, 'package-lock.json'), 'utf8'));
    const extension = lock('editors/vscode').version;
    bump('6.1.0-rc.0');
    assert.equal(lock('editors/language-server').packages[''].version, '6.1.0-rc.0');
    assert.equal(lock('editors/vscode').version, extension);
    assert.equal(lock('editors/vscode').packages['../language-server'].version, '6.1.0-rc.0');
    bump('6.1.0');
    assert.equal(lock('editors/language-server').version, '6.1.0');
    assert.equal(lock('editors/vscode').packages[''].version, '6.1.0');
    assert.equal(lock('editors/vscode').packages['../language-server'].version, '6.1.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('command names point at their file without "./", the form npm 11 keeps when publishing', () => {
  // npm 11 drops a bin written "./cli.js" ("script name … was invalid and removed"), so the
  // package would install without its command.
  for (const path of ['compiler', 'create', 'actions', 'editors/language-server']) {
    for (const [name, file] of Object.entries(json(`${path}/package.json`).bin)) {
      assert.doesNotMatch(file, /^\.\//, `${path}: bin ${name}`);
    }
  }
});

// The release workflow publishes when the version reaches main, with this section as the notes.
test('the release version has its notes in CHANGELOG.md', () => {
  const notes = execFileSync(process.execPath, [join(repo, 'scripts/release-notes.mjs'), version], { encoding: 'utf8' });
  assert.ok(notes.trim().length > 0);
  assert.doesNotMatch(notes, /^## /m, 'only this version\'s section');
});

test('the 6.0.0 release notes include the release candidate', { skip: version !== '6.0.0' }, () => {
  const notes = execFileSync(process.execPath, [join(repo, 'scripts/release-notes.mjs'), '6.0.0'], { encoding: 'utf8' });
  const candidate = execFileSync(process.execPath, [join(repo, 'scripts/release-notes.mjs'), '6.0.0-rc.0'], { encoding: 'utf8' });
  const headings = (text) => [...text.matchAll(/^- \*\*(.+?)\*\*/gm)].map((match) => match[1]);
  const released = new Set(headings(notes));
  for (const heading of headings(candidate)) assert.ok(released.has(heading), `6.0.0 notes omit: ${heading}`);
});

// npm's trusted publishing and provenance check the package against the repository it was built in:
// a package whose repository.url doesn't match is refused (as a 404).
// The packages scripts/publish.mjs publishes.
const PUBLISHED = ['runtime', 'compiler', 'server', 'plugin', 'editors/language-server', 'create', 'sync', 'actions', 'router'];

test('every published package names this repository and its folder', () => {
  for (const path of PUBLISHED) {
    const { repository } = json(`${path}/package.json`);
    assert.deepEqual(repository, { type: 'git', url: 'git+https://github.com/zubra-js/zubra.git', directory: path }, path);
  }
});

// What a package's npm page shows: its README (npm says "No README data found" without one), its
// license, a link to its folder, where to report a bug, and the words it's found by.
test('every published package has a README, a LICENSE, a homepage, bugs and keywords', () => {
  const publish = readFileSync(join(repo, 'scripts/publish.mjs'), 'utf8');
  for (const path of PUBLISHED) assert.match(publish, new RegExp(`\\{ dir: '${path}'`), `${path} is published by scripts/publish.mjs`);
  for (const path of PUBLISHED) {
    const pkg = json(`${path}/package.json`);
    for (const file of ['README.md', 'LICENSE']) assert.ok(readFileSync(join(repo, path, file), 'utf8').trim(), `${path}/${file}`);
    assert.equal(pkg.homepage, `https://github.com/zubra-js/zubra/tree/main/${path}#readme`, path);
    assert.deepEqual(pkg.bugs, { url: 'https://github.com/zubra-js/zubra/issues' }, path);
    for (const word of ['zubra', 'web components', 'custom elements']) assert.ok(pkg.keywords?.includes(word), `${path}'s keywords have "${word}"`);
    assert.ok(pkg.keywords.length > 3, `${path} has keywords of its own`);
  }
});

test('the Axum example\'s own lockfile and zubra-macros name this release of the crate', () => {
  // The example is its own workspace: a stale version here fails its `cargo test --locked`.
  const lock = readFileSync(join(repo, 'examples/backends/axum-garden/Cargo.lock'), 'utf8');
  assert.match(lock, new RegExp(`name = "zubra"\\nversion = "${version.replaceAll('.', '\\.')}"`));
  // The macro compiles with exactly the compiler the application links.
  assert.match(readFileSync(join(repo, 'macros/Cargo.toml'), 'utf8'), new RegExp(`^zubra = \\{ path = "\\.\\.", version = "=${version.replaceAll('.', '\\.')}" \\}$`, 'm'));
});
