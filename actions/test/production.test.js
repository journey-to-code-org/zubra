// The production build of the browser scripts (`dist/production`, what createActions serves in
// production): current with src/, smaller, and behaving as the scripts in src/ do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { brotliDecompressSync, gunzipSync, gzipSync } from 'node:zlib';
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

test('createActions defaults to production except in explicit development', async () => {
  const components = mkdtempSync(join(tmpdir(), 'zb-actions-default-'));
  const previous = process.env.NODE_ENV;
  try {
    for (const value of [undefined, 'production', 'test', 'development']) {
      if (value === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = value;
      const actions = await createActions({ components, cacheDir: join(components, 'cache') });
      const response = await actions.fetch(new Request('http://localhost/_zb/actions.js'));
      assert.equal(await response.text(), read(value === 'development' ? 'src' : 'dist/production', 'client.js'), String(value));
    }
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
    rmSync(components, { recursive: true, force: true });
  }
});

test('the minified form script passes the form script\'s own browser tests', () => {
  execFileSync(process.execPath, ['--test', join(root, 'test/enhance-forms.test.js')], { stdio: 'pipe', env: { ...process.env, ZUBRA_ACTIONS_SCRIPTS: 'dist/production', NODE_TEST_CONTEXT: undefined } });
});

test('production is the default: development only with NODE_ENV=development or production: false', async () => {
  const components = mkdtempSync(join(tmpdir(), 'zb-actions-default-'));
  const was = process.env.NODE_ENV;
  const served = async (env, options = {}) => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    try {
      return await (await (await createActions({ components, ...options })).fetch(new Request('http://localhost/_zb/actions.js'))).text();
    } finally {
      if (was === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = was;
    }
  };
  try {
    for (const env of [undefined, '', 'production', 'staging']) assert.equal(await served(env), read('dist/production', 'client.js'), `NODE_ENV ${env}`);
    assert.equal(await served('development'), read('src', 'client.js'));
    assert.equal(await served('production', { production: false }), read('src', 'client.js'));
  } finally {
    rmSync(components, { recursive: true, force: true });
  }
});

test('the browser scripts: cached as the runtime is, and with `compress` in Brotli or gzip', async () => {
  const components = mkdtempSync(join(tmpdir(), 'zb-actions-compress-'));
  const get = async (actions, path, accept) => {
    const response = await actions.fetch(new Request(`http://localhost${path}`, { headers: accept ? { 'accept-encoding': accept } : {} }));
    return { headers: Object.fromEntries(response.headers), bytes: Buffer.from(await response.arrayBuffer()) };
  };
  try {
    const production = await createActions({ components, production: true, compress: true });
    for (const [path, file] of [['/_zb/actions.js', 'client.js'], ['/_zb/enhance-forms.js', 'enhance-forms.js']]) {
      const source = read('dist/production', file);
      const br = await get(production, path, 'gzip, deflate, br');
      assert.equal(br.headers['content-encoding'], 'br');
      assert.equal(br.headers['cache-control'], 'public, max-age=3600');
      assert.equal(br.headers.vary, 'accept-encoding');
      assert.equal(brotliDecompressSync(br.bytes).toString(), source);
      assert.ok(br.bytes.length < Buffer.byteLength(source), `${file}: ${br.bytes.length} B of ${Buffer.byteLength(source)}`);
      const gz = await get(production, path, 'gzip');
      assert.equal(gz.headers['content-encoding'], 'gzip');
      assert.equal(gunzipSync(gz.bytes).toString(), source);
      const plain = await get(production, path, 'identity');
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.headers.vary, 'accept-encoding');
      assert.equal(plain.bytes.toString(), source);
    }
    // Without `compress`, as it is; in development, asked for again on each load.
    const asIs = await get(await createActions({ components, production: true }), '/_zb/actions.js', 'br');
    assert.equal(asIs.headers['content-encoding'], undefined);
    assert.equal(asIs.headers['cache-control'], 'public, max-age=3600');
    assert.equal((await get(await createActions({ components, production: false }), '/_zb/actions.js', 'br')).headers['cache-control'], 'no-cache');
  } finally {
    rmSync(components, { recursive: true, force: true });
  }
});
