// The plugin's options: `engine` is 'zubra' or 'signals' (`signals: true`, 6.0.0-rc.0's name, is
// the second), anything else is an error, and an option name it doesn't know is warned about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unplugin } from '../src/index.js';

const plugin = (options) => unplugin.raw(options, { framework: 'rollup' });
function warned(t, options) {
  const said = [];
  t.mock.method(console, 'warn', (message) => { said.push(message); });
  plugin(options);
  t.mock.restoreAll();
  return said;
}

test("engine: 'signals', 'zubra' or nothing is quiet; signals: true still works and says to write engine: 'signals'", async (t) => {
  assert.deepEqual(warned(t, { engine: 'signals' }), []);
  assert.deepEqual(warned(t, { engine: 'zubra' }), []);
  assert.deepEqual(warned(t, {}), []);
  assert.deepEqual(warned(t, { signals: true }), ["@zubra/unplugin: signals: true is engine: 'signals' since 6.0; write engine: 'signals'"]);
  // And it is the TC39 engine: the plugin resolves the runtime's engine to signal-tc39.js.
  const resolved = (options) => plugin(options).resolveId('./signal.js', '/app/node_modules/@zubra/runtime/src/index.js');
  t.mock.method(console, 'warn', () => {});
  await assert.rejects(resolved({ signals: true }), /engine: 'signals' needs @zubra\/runtime 6\.0 or later/);
  await assert.rejects(resolved({ engine: 'signals' }), /engine: 'signals' needs/);
  assert.equal(await resolved({ engine: 'zubra' }), null);
});

test('any other engine, or a signals that is not a boolean, is an error naming the two engines', () => {
  assert.throws(() => plugin({ engine: 'tc39' }), /@zubra\/unplugin: engine: 'tc39' isn't an engine; it is 'zubra' \(the default\) or 'signals'/);
  assert.throws(() => plugin({ signals: 'true' }), /signals: 'true' isn't true or false; write engine: 'signals'/);
  assert.throws(() => plugin({ engine: 'zubra', signals: true }), /disagree/);
});

test("an unknown option name is warned about with the nearest known one, signal as engine: 'signals'", (t) => {
  const said = warned(t, { signal: true, framwork: 'react', devtool: true, colour: 'red' });
  assert.equal(said.length, 4, said.join('\n'));
  assert.match(said[0], /^@zubra\/unplugin: unknown option `signal`; did you mean `engine: 'signals'`\?/);
  assert.match(said[1], /unknown option `framwork`; did you mean `framework`\?/);
  assert.match(said[2], /unknown option `devtool`; did you mean `devtools`\?/);
  assert.match(said[3], /unknown option `colour` \(it has compiler, framework, .*engine.*\)/);
});

test("every option in the typings is known, and the README's Options block names each", (t) => {
  const typings = readFileSync(new URL('../src/index.d.ts', import.meta.url), 'utf8');
  const declared = [...typings.match(/export interface ZubraOptions \{([\s\S]*?)\n\}/)[1].matchAll(/^  ([A-Za-z]+)\??:/gm)].map((match) => match[1]);
  assert.ok(declared.includes('engine') && declared.includes('devtools'), declared.join(', '));
  assert.deepEqual(warned(t, Object.fromEntries(declared.filter((name) => name !== 'signals').map((name) => [name, undefined]))), []);
  const unknown = warned(t, Object.fromEntries(declared.map((name) => [name, name === 'signals' ? false : name === 'engine' ? 'zubra' : null])));
  assert.deepEqual(unknown.filter((message) => message.includes('unknown option')), []);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const block = readme.slice(readme.indexOf('## Options'), readme.indexOf('\n## ', readme.indexOf('## Options') + 3));
  for (const name of declared.filter((name) => name !== 'signals')) assert.match(block, new RegExp(`\\n  ${name}:`), `README Options: ${name}`);
});
