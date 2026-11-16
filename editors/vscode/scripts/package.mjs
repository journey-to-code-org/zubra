// Builds zubra-<version>.vsix next to package.json:  npm run package
//
// The extension depends on @zubra/language-server by path (`file:../language-server`) so the repo's
// tests run against the working copy, but a .vsix has to carry the server in its own node_modules.
// So this packs a copy whose dependency is the published version (the packages are released together),
// installs only the runtime dependencies there, and checks the server made it into the package.
//
// It runs in the release job, which can publish (trusted publishing), so nothing in it is fetched
// at whatever version is newest that day: @vscode/vsce is this package's own devDependency (run
// `npm ci` here first), and the runtime dependencies are installed from this package's committed
// lockfile, without install scripts, then checked package by package against the versions and
// hashes in this package's and the language server's lockfiles. Anything else (a dependency of the
// published language server that has moved since its lockfile) stops the release until the
// lockfiles are updated and reviewed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInstalled, locked } from './locked.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const work = mkdtempSync(join(tmpdir(), 'zubra-vsix-'));
// A shell, because npm and npx are .cmd files on Windows, which Node won't start directly. The arguments are fixed strings.
const run = (command, args, { show = true } = {}) => execFileSync(command, args, { cwd: work, stdio: ['ignore', show ? 'inherit' : 'pipe', 'inherit'], shell: true })?.toString() ?? '';
const step = (message) => console.log(`vscode: ${message}`);
const vsce = join(here, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
if (!existsSync(vsce)) throw new Error('vscode: @vscode/vsce is not installed; run `npm ci` in editors/vscode first');

try {
  for (const name of ['LICENSE', 'README.md', 'icon.png', 'extension.js', 'language-configuration.json', 'syntaxes', 'icons', '.vscodeignore']) cpSync(join(here, name), join(work, name), { recursive: true });
  manifest.dependencies['@zubra/language-server'] = manifest.version;
  delete manifest.devDependencies;
  writeFileSync(join(work, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  // This package's lockfile, so the install keeps every version it records; only its link to the
  // working copy of the language server goes, which npm then takes from the registry, at the
  // version being released.
  const lockfile = JSON.parse(readFileSync(join(here, 'package-lock.json'), 'utf8'));
  delete lockfile.packages['../language-server'];
  delete lockfile.packages['node_modules/@zubra/language-server'];
  lockfile.packages[''].dependencies['@zubra/language-server'] = manifest.version;
  delete lockfile.packages[''].devDependencies;
  writeFileSync(join(work, 'package-lock.json'), `${JSON.stringify(lockfile, null, 2)}\n`);
  step('installing the extension\'s dependencies (the first run can take a minute)…');
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  step('checking the installed dependencies against the committed lockfiles…');
  const known = new Map([...locked(join(here, 'package-lock.json')), ...locked(join(here, '..', 'language-server', 'package-lock.json'))]);
  checkInstalled(JSON.parse(readFileSync(join(work, 'package-lock.json'), 'utf8')), known, manifest.version);
  rmSync(join(work, 'package-lock.json'));
  step('checking what would go in the package…');
  const files = run(vsce, ['ls'], { show: false });
  for (const needed of ['node_modules/@zubra/language-server/server.js', 'node_modules/@zubra/language-server/packages.js', 'node_modules/@zubra/language-server/typecheck-worker.js', 'node_modules/@zubra/language-server/typescript.js', 'node_modules/@zubra/language-server/typescript-plugin/index.js', 'node_modules/@zubra/language-server/typescript-plugin/package.json', 'node_modules/@zubra/language-server/typings.mjs', 'node_modules/typescript/lib/typescript.js', 'node_modules/vscode-languageclient/package.json', 'icon.png', 'README.md', 'icons/zb-light.svg', 'icons/zb-dark.svg']) {
    if (!files.includes(needed)) throw new Error(`the package would be missing ${needed}`);
  }
  const vsix = `zubra-${manifest.version}.vsix`;
  step('packaging…');
  run(vsce, ['package', '--out', vsix]);
  copyFileSync(join(work, vsix), join(here, vsix)); // not renamed: the temp folder can be on another drive
  console.log(`vscode: ${join(here, vsix)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
