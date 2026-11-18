// The canary's choice of versions (scripts/canary.mjs), with no network: dist-tags are given.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareVersions, pickVersion, plan } from './canary.mjs';

test('versions order as semver, prereleases before their release', () => {
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.10.0', '2.0.0-rc.21', '2.0.0'];
  for (let i = 0; i < ordered.length; i++) {
    for (let j = 0; j < ordered.length; j++) assert.equal(compareVersions(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
  }
  assert.equal(compareVersions('19.3.0-canary-d5736f09-20260507', '19.3.1'), -1);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0'), 0);
});

test('latest takes latest; next takes the newest prerelease only when it is ahead of latest', () => {
  // React's `next` is a canary of a release that already shipped: stay on latest.
  const react = { latest: '19.3.1', next: '19.3.0-canary-d5736f09-20260507', rc: '19.0.0-rc.1' };
  assert.equal(pickVersion(react, 'latest'), '19.3.1');
  assert.equal(pickVersion(react, 'next'), '19.3.1');
  // Solid's `next` is its 2.0 release candidate.
  assert.equal(pickVersion({ latest: '1.9.19', next: '2.0.0-rc.21', beta: '1.10.0-beta.0' }, 'next'), '2.0.0-rc.21');
  // Vue has no `next` tag, but an `rc` ahead of `beta`.
  assert.equal(pickVersion({ latest: '3.5.45', alpha: '3.6.0-alpha.7', beta: '3.6.0-beta.17', rc: '3.6.0-rc.14' }, 'next'), '3.6.0-rc.14');
  assert.equal(pickVersion({ next: '1.0.0' }, 'next'), undefined);
});

test('plan moves frameworks and their plugins by channel, and leaves aliases and local packages alone', () => {
  const tags = {
    react: { latest: '19.3.1', next: '19.3.0-canary-x' },
    'solid-js': { latest: '1.9.19', next: '2.0.0-rc.21' },
    '@angular/core': { latest: '22.3.0', next: '23.0.0-next.4' },
    'vite-plugin-solid': { latest: '3.1.0', next: '4.0.0-beta.1' },
  };
  const pkg = {
    dependencies: { react: '19.3.1', 'solid-js': '^1.9.18' },
    devDependencies: {
      '@angular/core': '22.2.5', 'vite-plugin-solid': '3.0.0', react18: 'npm:react@18.3.1',
      '@zubra/runtime': 'file:../../runtime', playwright: '1.63.0',
    },
  };
  assert.deepEqual(plan(pkg, 'next', (name) => tags[name]), [
    { field: 'dependencies', name: 'solid-js', from: '^1.9.18', to: '2.0.0-rc.21' },
    { field: 'devDependencies', name: '@angular/core', from: '22.2.5', to: '23.0.0-next.4' },
    { field: 'devDependencies', name: 'vite-plugin-solid', from: '3.0.0', to: '4.0.0-beta.1' },
  ]);
  assert.deepEqual(plan(pkg, 'latest', (name) => tags[name]).map(({ name, to }) => `${name}@${to}`), ['solid-js@1.9.19', '@angular/core@22.3.0', 'vite-plugin-solid@3.1.0']);
  // A package npm doesn't know is skipped, not a failure.
  assert.deepEqual(plan({ dependencies: { react: '19.0.0' } }, 'latest', () => undefined), []);
});

test('a lockstep family follows its leader where the leader\'s version exists for the member', () => {
  const tags = {
    '@angular/core': { latest: '22.2.5', rc: '22.3.0-rc.0', next: '22.3.0-next.5' },
    '@angular/build': { latest: '22.2.6', next: '22.3.0-next.5' },
    '@angular/ssr': { latest: '22.2.6', next: '22.3.0-next.5' },
  };
  const exists = (name, version) => name === '@angular/build' && version === '22.3.0-rc.0';
  const pkg = { devDependencies: { '@angular/core': '22.2.5', '@angular/build': '22.2.6', '@angular/ssr': '22.2.6' } };
  assert.deepEqual(plan(pkg, 'next', (name) => tags[name], exists).map(({ name, to }) => `${name}@${to}`), [
    '@angular/core@22.3.0-rc.0', '@angular/build@22.3.0-rc.0', '@angular/ssr@22.3.0-next.5',
  ]);
});

test('on latest, a framework is held where its plugin\'s or meta-framework\'s peer range ends', () => {
  // The day solid-js 2 became `latest`, with vite-plugin-solid and @solidjs/start still on Solid 1.
  const tags = {
    'solid-js': { latest: '2.0.1', next: '2.0.1' },
    'vite-plugin-solid': { latest: '2.11.16', next: '3.0.0-next.27' },
    '@solidjs/start': { latest: '2.2.3', rc: '2.0.0-rc.10' },
    react: { latest: '19.3.1' },
  };
  const peers = {
    'vite-plugin-solid@2.11.16': { 'solid-js': '^1.7.2', vite: '^8.0.0' },
    'vite-plugin-solid@3.0.0-next.27': {},
    '@solidjs/start@2.2.3': { 'solid-js': '^1.9.15' },
  };
  const releases = { 'solid-js': ['1.9.18', '1.9.19', '2.0.0', '2.0.1'] };
  const peersOf = (name, version) => peers[`${name}@${version}`] ?? {};
  // The newest release a caret range allows (all these tests need).
  const newestIn = (name, range) => (releases[name] ?? []).filter((version) => version.split('.')[0] === range.replace(/^\^/, '').split('.')[0]).at(-1);
  const app = { dependencies: { 'solid-js': '1.9.18', react: '19.3.1' }, devDependencies: { 'vite-plugin-solid': '2.11.15' } };
  assert.deepEqual(plan(app, 'latest', (name) => tags[name], undefined, peersOf, newestIn), [
    { field: 'dependencies', name: 'solid-js', from: '1.9.18', to: '1.9.19', held: 'vite-plugin-solid 2.11.16 needs solid-js ^1.7.2' },
    { field: 'devDependencies', name: 'vite-plugin-solid', from: '2.11.15', to: '2.11.16' },
  ]);
  // A pinned meta-framework holds it as well (here it would otherwise move); held at the pin, nothing changes.
  const start = { dependencies: { '@solidjs/start': '2.2.3', 'solid-js': '1.9.19' } };
  assert.deepEqual(plan(start, 'latest', (name) => tags[name], undefined, peersOf, newestIn), []);
  // `next` ignores peer ranges: it is there to try the new major, with its tooling's next.
  assert.deepEqual(plan(app, 'next', (name) => tags[name], undefined, peersOf, newestIn).map(({ name, to }) => `${name}@${to}`), ['solid-js@2.0.1', 'vite-plugin-solid@3.0.0-next.27']);
  // Without peer information (npm unreachable), latest moves as before.
  assert.deepEqual(plan(app, 'latest', (name) => tags[name]).map(({ name, to }) => `${name}@${to}`), ['solid-js@2.0.1', 'vite-plugin-solid@2.11.16']);
});
