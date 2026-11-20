// 6.0: development mode is opt-in. A server that doesn't set NODE_ENV is production (errors say
// only "Something went wrong", the runtime's production build); NODE_ENV=development or
// `production: false` is development, and says so once at start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZubra } from '../src/index.js';

const components = mkdtempSync(join(tmpdir(), 'zubra-production-default-'));
writeFileSync(join(components, 'say-word.zb'), '<say-word>\n  <p>word</p>\n</say-word>\n');
test.after(() => rmSync(components, { recursive: true, force: true }));

/** createZubra with NODE_ENV set to `env` (undefined: unset), and what it said at start. */
function under(env, options = {}) {
  const was = process.env.NODE_ENV;
  const info = console.info;
  const said = [];
  console.info = (message) => said.push(message);
  if (env === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env;
  try {
    return { zubra: createZubra({ components, ...options }), said };
  } finally {
    console.info = info;
    if (was === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = was;
  }
}
const isProduction = (zubra) => zubra.errorPage(new Error('secret')).body === 'Something went wrong';

for (const env of [undefined, '', 'production', 'staging', 'test']) {
  test(`NODE_ENV ${env === undefined ? 'unset' : JSON.stringify(env)}: production, and nothing said`, () => {
    const { zubra, said } = under(env);
    assert.ok(isProduction(zubra));
    assert.deepEqual(said, []);
  });
}

test('NODE_ENV=development: development, said once at start', () => {
  const { zubra, said } = under('development');
  assert.ok(!isProduction(zubra));
  assert.deepEqual(said, ['@zubra/server: development mode (NODE_ENV=development)']);
});

test('production: false is development whatever NODE_ENV says, and production: true is production', () => {
  const off = under('production', { production: false });
  assert.ok(!isProduction(off.zubra));
  assert.deepEqual(off.said, ['@zubra/server: development mode (production: false)']);
  const on = under('development', { production: true });
  assert.ok(isProduction(on.zubra));
  assert.deepEqual(on.said, []);
});

test('the default serves the runtime as production does, the DevTools build only in development', () => {
  const page = (zubra) => {
    const one = zubra.page();
    one.render('say-word');
    return one.finish('<html><head></head><body></body></html>');
  };
  assert.equal(page(under(undefined).zubra), page(under('production').zubra));
  assert.notEqual(page(under(undefined).zubra), page(under('development').zubra));
});
