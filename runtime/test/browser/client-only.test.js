// `--client-only` (@zubra/unplugin's `hydrate: false`): a component compiled for an app that never
// renders on a server leaves hydration out, so the runtime's hydrate.js isn't imported. It still
// works over markup it meets, rendering fresh instead of taking it over. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useBrowser, open, here, compiler, runtimeOnly } from './harness.js';

const counter = join(here, 'fixtures/counter.zb');
const props = join(tmpdir(), 'zb-client-only-props.json');
writeFileSync(props, '{}');
let clientModule = '';
useBrowser({ counter }, {
  'counter-client.js': () => (clientModule = compiler(counter, '--emit', 'js', '--client-only')),
});

// The server's markup for the counter, and the button in it before any module runs.
const page = (module) => open(compiler(counter, '--props', props, '--partial'), {
  beforeModules: "window.serverButton = document.querySelector('zb-counter button');",
  modules: [module],
});
const after = () => async () => {
  const host = document.querySelector('zb-counter');
  await host.updateComplete;
  const button = host.querySelector('button');
  const before = button.textContent;
  button.click();
  await host.updateComplete;
  return { kept: button === window.serverButton, before, clicked: button.textContent, buttons: host.querySelectorAll('button').length };
};

test('by default a component takes over the server markup it meets', { skip: runtimeOnly }, async () => {
  const { page: browserPage, messages } = await page('counter');
  const result = await browserPage.evaluate(after());
  assert.deepEqual(result, { kept: true, before: 'Clicks: 0', clicked: 'Clicks: 1', buttons: 1 });
  assert.deepEqual(messages, []);
});

test('compiled --client-only it imports no hydration, and renders fresh over markup it meets', { skip: runtimeOnly }, async () => {
  assert.ok(!clientModule.includes('hydrat'), clientModule);
  const { page: browserPage } = await page('counter-client');
  const result = await browserPage.evaluate(after());
  // A new button, working; the server's isn't shown (it's the page's own content now).
  assert.deepEqual(result, { kept: false, before: 'Clicks: 0', clicked: 'Clicks: 1', buttons: 1 });
});
