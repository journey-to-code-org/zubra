// The .vsix's dependencies are checked against the committed lockfiles (scripts/locked.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkInstalled, locked } from '../scripts/locked.mjs';

const lock = (packages) => {
  const file = join(mkdtempSync(join(tmpdir(), 'zubra-locked-')), 'package-lock.json');
  writeFileSync(file, JSON.stringify({ lockfileVersion: 3, packages }));
  return file;
};
const known = locked(lock({
  '': { name: 'zubra' },
  '../language-server': { version: '5.19.0' },
  'node_modules/@zubra/language-server': { resolved: '../language-server', link: true },
  'node_modules/semver': { version: '7.7.3', integrity: 'sha512-good' },
  'node_modules/vscode-languageclient': { version: '11.0.0', integrity: 'sha512-client' },
  'node_modules/@vscode/vsce': { version: '4.1.1', integrity: 'sha512-vsce', dev: true },
}));

test('the runtime packages of a lockfile, by name and version, without dev or linked ones', () => {
  assert.deepEqual([...known.keys()].sort(), ['semver@7.7.3', 'vscode-languageclient@11.0.0']);
});

test('an install of exactly those, with the language server being released, passes', () => {
  checkInstalled({ packages: {
    '': {},
    'node_modules/@zubra/language-server': { version: '5.19.1', integrity: 'sha512-anything' },
    'node_modules/semver': { version: '7.7.3', integrity: 'sha512-good' },
    'node_modules/vscode-languageclient/node_modules/semver': { version: '7.7.3', integrity: 'sha512-good' },
    'node_modules/vscode-languageclient': { version: '11.0.0', integrity: 'sha512-client' },
  } }, known, '5.19.1');
});

test('a version no lockfile has, a different hash, a dev-only package or another language server stops it', () => {
  const install = (extra) => ({ packages: { 'node_modules/@zubra/language-server': { version: '5.19.1' }, ...extra } });
  assert.throws(() => checkInstalled(install({ 'node_modules/semver': { version: '7.7.4', integrity: 'sha512-new' } }), known, '5.19.1'), /semver@7\.7\.4 \(no committed lockfile has this version\)/);
  assert.throws(() => checkInstalled(install({ 'node_modules/semver': { version: '7.7.3', integrity: 'sha512-evil' } }), known, '5.19.1'), /semver@7\.7\.3 \(its hash differs/);
  assert.throws(() => checkInstalled(install({ 'node_modules/@vscode/vsce': { version: '4.1.1', integrity: 'sha512-vsce' } }), known, '5.19.1'), /@vscode\/vsce@4\.1\.1/);
  assert.throws(() => checkInstalled(install({}), known, '5.20.0'), /@zubra\/language-server@5\.19\.1 \(expected 5\.20\.0\)/);
});
