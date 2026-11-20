// The runtime's errors end with "(see <the reference>#<section>)". Each section they name must be a
// heading of docs/reference.md, so the link lands on what the message is about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const src = join(root, 'runtime/src');

/** GitHub's anchor for a heading: lowercased, punctuation dropped, spaces to hyphens. */
const anchor = (heading) => heading.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');

test('every section a runtime message links to is a heading of docs/reference.md', () => {
  const headings = new Set(readFileSync(join(root, 'docs/reference.md'), 'utf8').match(/^#+ .*$/gm).map((line) => anchor(line.replace(/^#+ /, ''))));
  const linked = new Set();
  for (const file of readdirSync(src).filter((name) => name.endsWith('.js'))) {
    const code = readFileSync(join(src, file), 'utf8');
    if (/const see = /.test(code)) assert.match(code, /const see = \(section\) => ` \(see https:\/\/github\.com\/zubra-js\/zubra\/blob\/main\/docs\/reference\.md#\$\{section\}\)`;/, `${file}'s see()`);
    for (const [, section] of code.matchAll(/\bsee\('([^']+)'\)/g)) linked.add(section);
  }
  assert.ok(linked.size >= 8, `found the sections: ${[...linked]}`);
  for (const section of linked) assert.ok(headings.has(section), `#${section} is not a heading of docs/reference.md`);
});
