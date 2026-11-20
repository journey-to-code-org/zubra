// How a component's compile error and warnings reach the developer through Vite: in the overlay
// with the file, line and frame (also when the typings' compile is the one that fails), each said
// once, without the plugin's own stack frames or a doubled `error:`/`warning:`.
import { test, before, after } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import zubra from '../src/vite.js';
import { splitWarnings } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const compiler = process.env.ZUBRA_COMPILER ?? join(here, '../../target/debug/zubra');
const work = join(here, '.tmp', 'errors');
// The CLI this checkout builds, as plugin.test.js has it (the files run side by side, so each builds).
before(() => {
  if (!process.env.ZUBRA_COMPILER) execFileSync('cargo', ['build', '--quiet'], { cwd: join(here, '../..'), stdio: 'inherit' });
});
after(() => rmSync(work, { recursive: true, force: true }));

const BROKEN = '<script>\n  let = = 2\n</script>\n<my-card><p>hi</p></my-card>\n';

/** A vanilla app (no framework) with one component. */
function vanilla(name, card) {
  const root = join(work, name);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'components'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<script type="module" src="/src/main.js"></script><my-card></my-card>');
  writeFileSync(join(root, 'src/main.js'), "import '../components/card.zb';\n");
  writeFileSync(join(root, 'components/card.zb'), card);
  return root;
}

async function devServer(root, options = {}) {
  const logged = [];
  const customLogger = { info() {}, warn: (message) => logged.push(String(message)), warnOnce() {}, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false, error: (message) => logged.push(String(message)) };
  const server = await createServer({ root, configFile: false, customLogger, plugins: [zubra({ compiler, ...options })], server: { port: 0, host: '127.0.0.1', ws: false }, optimizeDeps: { noDiscovery: true } });
  return { server, logged };
}

test('a script error (which the typings compile meets first) reaches the overlay with its file, line and frame, and none of the plugin\'s frames', async () => {
  const root = vanilla('script', BROKEN);
  const { server } = await devServer(root);
  try {
    const error = await server.transformRequest('/components/card.zb?zubra=element').then(() => null, (thrown) => thrown);
    assert.ok(error, 'it fails');
    assert.equal(error.plugin, 'zubra');
    assert.deepEqual(error.loc, { file: join(root, 'components/card.zb'), line: 2, column: 9 });
    assert.match(error.frame, /2 \|   let = = 2\n\s+\|\s+\^/);
    // The message is the first line: the frame (the source line, the caret, the help) is shown
    // after it by Vite, so in the message it would be said twice.
    assert.equal(error.message, 'invalid <script>: Unexpected token');
    assert.doesNotMatch(String(error.stack ?? ''), /plugin[\\/]src[\\/]index\.js/);
  } finally {
    await server.close();
  }
});

test('the same with typings off: the component\'s own compile fails the same way', async () => {
  const root = vanilla('script-no-dts', BROKEN);
  const { server } = await devServer(root, { dts: false });
  try {
    const error = await server.transformRequest('/components/card.zb?zubra=element').then(() => null, (thrown) => thrown);
    assert.equal(error?.loc?.line, 2);
    assert.equal(error.message, 'invalid <script>: Unexpected token');
  } finally {
    await server.close();
  }
});

test('a crash of the plugin itself keeps its stack', async () => {
  const root = vanilla('crash', '<my-card><p>hi</p></my-card>\n');
  const { server } = await devServer(root, { compiler: join(work, 'no-such-compiler') });
  try {
    const error = await server.transformRequest('/components/card.zb?zubra=element').then(() => null, (thrown) => thrown);
    assert.match(error?.message ?? '', /couldn't run the compiler/);
    assert.match(String(error.stack), /plugin[\\/]src[\\/]index\.js/, 'where it was thrown');
  } finally {
    await server.close();
  }
});

test('a build says the error once: the source line appears once, and no `error: error:`', async () => {
  const root = vanilla('build', BROKEN);
  const error = await build({ root, configFile: false, logLevel: 'silent', plugins: [zubra({ compiler })], build: { outDir: join(root, 'dist') } }).then(() => null, (thrown) => thrown);
  assert.ok(error, 'the build fails');
  assert.equal(error.message.match(/let = = 2/g)?.length, 1, error.message);
  assert.doesNotMatch(error.message, /error: error:|Error: error:/i);
  assert.doesNotMatch(String(error.stack), /plugin[\\/]src[\\/]index\.js/);
});

test("a warning is said without the compiler's `warning: `, which the bundler adds; two are two", async () => {
  assert.deepEqual(splitWarnings(''), []);
  assert.deepEqual(splitWarnings('warning: one\n --> a.zb:1:1\n\nwarning: two\n --> a.zb:2:1\n'), ['one\n --> a.zb:1:1', 'two\n --> a.zb:2:1']);
  const root = vanilla('warning', '<my-card><p className="x">hi</p><span className="y"></span></my-card>\n');
  const { server, logged } = await devServer(root);
  try {
    await server.transformRequest('/components/card.zb?zubra=element');
    const warnings = logged.filter((line) => /className/.test(line));
    assert.equal(warnings.length, 2, logged.join('\n----\n'));
    for (const warning of warnings) assert.doesNotMatch(warning, /warning: warning:/);
  } finally {
    await server.close();
  }
});
