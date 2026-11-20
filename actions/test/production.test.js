// The production build of the browser scripts (`dist/production`, what createActions serves in
// production): current with src/, smaller, and behaving as the scripts in src/ do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActions } from '../src/index.js';
import { BROWSER } from '../scripts/build-production.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (folder, file) => readFileSync(join(root, folder, file), 'utf8');

test('dist/production is built from the current src (npm run build)', () => {
  execFileSync(process.execPath, [join(root, 'scripts/build-production.js'), '--check'], { stdio: 'pipe' });
});

test('each script is well under its source in bytes, and still a module of the same exports', async () => {
  for (const file of BROWSER) {
    const gzipped = (folder) => gzipSync(read(folder, file), { level: 9 }).length;
    assert.ok(gzipped('dist/production') < gzipped('src') * 0.65, `${file}: ${gzipped('dist/production')} B against ${gzipped('src')} B`);
    const names = (text) => [...text.matchAll(/export\s*(?:function\s+(\w+)|\{([^}]*)\})/g)].flatMap(([, one, list]) => (one ? [one] : list.split(',').map((name) => name.trim().split(/\s+as\s+/).pop()))).sort();
    assert.deepEqual(names(read('dist/production', file)), names(read('src', file)), file);
  }
});

test('createActions serves the minified scripts in production and the source otherwise', async () => {
  const components = mkdtempSync(join(tmpdir(), 'zb-actions-production-'));
  try {
    for (const [path, file] of [['/_zb/actions.js', 'client.js'], ['/_zb/enhance-forms.js', 'enhance-forms.js']]) {
      const served = async (options) => (await (await createActions({ components, ...options })).fetch(new Request(`http://localhost${path}`))).text();
      assert.equal(await served({ production: true }), read('dist/production', file), `${file} in production`);
      assert.equal(await served({ production: false }), read('src', file), `${file} in development`);
    }
  } finally {
    rmSync(components, { recursive: true, force: true });
  }
});

test('the minified form script passes the form script\'s own browser tests', () => {
  execFileSync(process.execPath, ['--test', join(root, 'test/enhance-forms.test.js')], { stdio: 'pipe', env: { ...process.env, ZUBRA_ACTIONS_SCRIPTS: 'dist/production', NODE_TEST_CONTEXT: undefined } });
});
