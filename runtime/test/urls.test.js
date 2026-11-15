// The URL rule in the browser: the runtime's isSafeUrl, and the copy `--emit element` writes into
// plain elements (src/element_helpers.js), must agree with the compiler's (src/validate.rs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isSafeUrl } from '../src/index.js';

// The helper as `--emit element` writes it: the `//@@ isSafeUrl:` section, `@` dropped.
const source = readFileSync(new URL('../../src/element_helpers.js', import.meta.url), 'utf8');
const section = source.split('//@@ isSafeUrl:')[1].split('//@@')[0].replace('function @isSafeUrl', 'return function');
const elementIsSafeUrl = new Function(section)();

for (const [name, check] of [['runtime', isSafeUrl], ['--emit element', elementIsSafeUrl]]) {
  test(`${name}: a backslash is a slash, so /\\host and \\\\host are other sites`, () => {
    for (const url of ['/\\evil.example', '\\\\evil.example', '\\/evil.example', ' /\\evil.example/x']) assert.equal(check(url), false, url);
    for (const url of ['/orders', 'https://example.com/a\\b', 'a\\b', '?q=\\', 'mailto:a@example.com']) assert.equal(check(url), true, url);
    assert.equal(check('javascript:alert(1)'), false);
  });
}
