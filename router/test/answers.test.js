import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedLocation, redirect } from '../src/answers.js';

test('redirect locations cannot hide an external origin behind control characters', () => {
  const base = new URL('https://site.example/start');
  for (const location of ['/\t/evil.example/login', '/\n\\evil.example/login', '/cart\r', '\0/cart']) {
    for (const external of [false, true]) {
      assert.throws(() => checkedLocation(redirect(location, { external }), base), /control character/);
    }
  }
  assert.equal(checkedLocation(redirect('//evil.example/login'), base), '/evil.example/login');
  assert.equal(checkedLocation(redirect('/cart?x=1'), base), '/cart?x=1');
  assert.equal(checkedLocation(redirect('https://other.example/', { external: true }), base), 'https://other.example/');
  assert.throws(() => checkedLocation(redirect('https://other.example/'), base), /another site/);
});
