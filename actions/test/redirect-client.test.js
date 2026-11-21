import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the Actions client ignores unsafe redirect locations without posting again', async () => {
  const saved = new Map(['document', 'location', 'HTMLFormElement', 'FormData', 'fetch'].map((key) => [key, globalThis[key]]));
  const previousWarn = console.warn;
  const warnings = [];
  const navigations = [];
  let submit;
  let posts = 0;
  class Form {
    getAttribute(name) { return name === 'method' ? 'post' : name === 'action' ? '/_zb/action/x/go' : null; }
    hasAttribute() { return false; }
    dispatchEvent() { return true; }
    setAttribute() {}
    removeAttribute() {}
  }
  globalThis.HTMLFormElement = Form;
  globalThis.FormData = class {};
  globalThis.document = { addEventListener: (_, listener) => { submit = listener; } };
  globalThis.location = { href: 'https://site.test/page', origin: 'https://site.test', pathname: '/page', search: '', assign: (url) => navigations.push(String(url)), reload: () => {} };
  console.warn = (...args) => warnings.push(args);
  try {
    await import('../src/client.js');
    for (const next of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'http://[', '/safe']) {
      globalThis.fetch = async () => {
        posts++;
        return { headers: new Headers({ 'zb-location': next }) };
      };
      await submit({ target: new Form(), preventDefault() {} });
    }
    assert.equal(posts, 4);
    assert.deepEqual(navigations, ['https://site.test/safe']);
    assert.equal(warnings.length, 3);
  } finally {
    console.warn = previousWarn;
    for (const [key, value] of saved) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
