// The types say what the code takes: every option `createZubra` reads is in `ZubraOptions`. An
// option added to the function and not to the types works, and doesn't compile in a TypeScript
// server (#375: `packages`, which the guide documents, and `imports`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (file) => readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');

/** Read by the function and left out of the types on purpose: not documented anywhere yet. */
const UNDOCUMENTED = ['clientModules'];

test('ZubraOptions declares every option createZubra reads', () => {
  // (createZubra checks `engine` and the names, then hands the rest to `create`.)
  const parameters = read('index.js').match(/\nfunction create\(\{([^\n]*)\} = \{\}\)/)?.[1];
  assert.ok(parameters, "createZubra's options weren't found: has its signature changed?");
  // Each option is `name` or `name = default`; a default can hold commas, so split where a new name starts.
  const taken = [...[...parameters.matchAll(/(?:^|,)\s*([A-Za-z]+)\s*(?==|,|$)/g)].map((match) => match[1]), 'engine'];
  // The names it warns about are the others: its list is every one it reads.
  const known = JSON.parse(read('index.js').match(/\nconst OPTIONS = (\[[^\]]*\]);/)[1].replaceAll("'", '"'));
  assert.deepEqual([...known].sort(), [...taken].sort(), "createZubra's OPTIONS (what it doesn't warn about) are what it reads");
  assert.ok(taken.includes('components') && taken.includes('packages'), `not the options: ${taken.join(', ')}`);
  const options = read('index.d.ts').match(/export interface ZubraOptions \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(options, "ZubraOptions wasn't found");
  const declared = [...options.matchAll(/^  ([A-Za-z]+)\??:/gm)].map((match) => match[1]);
  assert.deepEqual(taken.filter((name) => !declared.includes(name) && !UNDOCUMENTED.includes(name)), [], 'read by createZubra, missing from ZubraOptions');
  assert.deepEqual(declared.filter((name) => !taken.includes(name)), [], 'in ZubraOptions, not read by createZubra');
});
