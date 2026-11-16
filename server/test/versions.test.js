// A compiler later than the runtime it compiles for: the server says so when it starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { versionSkew } from '../src/versions.js';
import { createZubra } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));

test('a compiler later than the runtime is named with both versions and the install that fixes it', () => {
  const message = versionSkew('5.19.0', '5.18.0');
  assert.match(message, /@zubra\/compiler is 5\.19\.0 and @zubra\/runtime is 5\.18\.0/);
  assert.match(message, /Failed to resolve module specifier/);
  assert.match(message, /npm install @zubra\/runtime@5\.19\.0 @zubra\/server@5\.19\.0/);
  assert.match(message, /npm install @zubra\/compiler@5\.18\.0/);
  // A patch can bring a new interface too (5.19.1 did).
  assert.ok(versionSkew('5.19.1', '5.19.0'));
  assert.ok(versionSkew('6.0.0', '5.30.2'));
  assert.ok(versionSkew('5.20.0-next.1', '5.19.4'));
});

test('the same release, an older compiler, and a version that can\'t be read say nothing', () => {
  assert.equal(versionSkew('5.19.0', '5.19.0'), null);
  assert.equal(versionSkew('5.18.0', '5.19.0'), null, 'the runtime runs what an older compiler wrote');
  assert.equal(versionSkew('5.9.0', '5.10.0'), null, 'compared as numbers, not text');
  assert.equal(versionSkew('5.19.0-next.1', '5.19.0'), null);
  assert.equal(versionSkew(null, '5.19.0'), null);
  assert.equal(versionSkew('5.19.0', null), null);
});

test('createZubra says nothing when the installed compiler and runtime are one release', () => {
  const warned = [];
  createZubra({ components: join(here, 'components'), warn: (message) => warned.push(message) });
  assert.deepEqual(warned.filter((message) => message.includes('@zubra/compiler is')), []);
});

test('createZubra warns once, at start, when the installed runtime is older than the compiler', () => {
  // An app's node_modules with this checkout's server and compiler, and a runtime that says 5.0.0.
  const app = mkdtempSync(join(tmpdir(), 'zubra-skew-'));
  try {
    const scope = join(app, 'node_modules', '@zubra');
    mkdirSync(scope, { recursive: true });
    const skip = (from) => !/node_modules|[\\/]test([\\/]|$)/.test(from.slice(join(here, '..', '..').length));
    for (const name of ['server', 'compiler', 'runtime']) cpSync(join(here, '..', '..', name), join(scope, name), { recursive: true, filter: skip });
    const manifest = join(scope, 'runtime', 'package.json');
    const { version } = JSON.parse(readFileSync(join(scope, 'compiler', 'package.json'), 'utf8'));
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version: '5.0.0' }));
    mkdirSync(join(app, 'components'));
    writeFileSync(join(app, 'components', 'hello-there.zb'), '<hello-there name="you"><p>Hello {name}</p></hello-there>\n');
    writeFileSync(join(app, 'app.mjs'), "import { createZubra } from '@zubra/server';\ncreateZubra({ components: 'components' });\ncreateZubra({ components: 'components', warn: (message) => console.log('WARN ' + message) });\n");
    const run = spawnSync(process.execPath, ['app.mjs'], { cwd: app, encoding: 'utf8', env: { ...process.env, ZUBRA_COMPILER: process.env.ZUBRA_COMPILER ?? '' } });
    assert.equal(run.status, 0, run.stderr);
    // Without `warn`, to the console; with it, to it.
    assert.match(run.stderr, new RegExp(`@zubra/compiler is ${version.replaceAll('.', '\\.')} and @zubra/runtime is 5\\.0\\.0`));
    assert.match(run.stdout, /^WARN @zubra\/server: @zubra\/compiler is /m);
    assert.equal(run.stderr.match(/@zubra\/compiler is/g).length, 1);
  } finally {
    rmSync(app, { recursive: true, force: true });
  }
});
