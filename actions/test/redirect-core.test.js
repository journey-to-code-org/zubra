import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createActionsCore } from '../src/core.js';

test('only HTTP redirects are sent to the enhanced client', async () => {
  for (const [location, safe] of [
    ['/next#done', true],
    ['https://example.com/next', true],
    ['javascript:alert(1)', false],
    [' JaVaScRiPt:alert(1)', false],
    ['java\tscript:alert(1)', false],
    ['data:text/html,test', false],
    ['http://[', false],
  ]) {
    const routes = new Map([['/_zb/action/x/go', () => new Response(null, { status: 303, headers: { location } })]]);
    const actions = createActionsCore({ routes });
    const response = await actions.fetch(new Request('https://site.test/_zb/action/x/go', {
      method: 'POST',
      body: new FormData(),
      headers: { accept: 'application/json' },
    }));
    assert.equal(response.status, safe ? 204 : 303, location);
    assert.equal(response.headers.get('zb-location'), safe ? location : null, location);
  }
});
