// Interface 4 as 5.18.0 first released it, beside what the compiler writes now: a library built
// with 5.18 keeps its event modifiers, form association, hydration, window listeners, class
// lists and toggles, style properties and URL checks on this runtime. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useBrowser, open, here, compiler, runtimeOnly } from './harness.js';

const dir = join(here, 'fixtures/interface');
const source = join(dir, 'since-4.zb');
const old = readFileSync(join(dir, 'since-4-518.js'), 'utf8');
useBrowser({ 'since-4': source }, { 'since-4-518.js': old });

const TAGS = ['zb-since', 'zb-since-518'];
const read = (page) => page.evaluate(async (tags) => {
  const out = {};
  for (const tag of tags) {
    const host = document.querySelector(tag);
    await host.updateComplete;
    const link = host.querySelector('a');
    out[tag] = {
      output: host.querySelector('output').textContent,
      href: link.getAttribute('href'),
      classes: [...link.classList].sort().join(' '),
      width: link.style.width,
      value: new FormData(host.closest('form')).get(tag),
    };
  }
  return out;
}, TAGS);
const each = (page, code) => page.evaluate(`for (const host of document.querySelectorAll('${TAGS.join(', ')}')) { ${code} } undefined`);

test('a module compiled by 5.18.0 behaves as one compiled now', async () => {
  assert.match(old, /abi: 4,/, 'the checked-in module is interface 4');
  assert.doesNotMatch(old, /binder: \$modified|forming|hydrating/, 'as 5.18.0 wrote it, before those were named');
  const { page, messages } = await open(`<form>${TAGS.map((tag) => `<${tag} name="${tag}"></${tag}>`).join('')}</form>`, { modules: ['since-4', 'since-4-518'] });

  const start = await read(page);
  assert.deepEqual(start['zb-since-518'], start['zb-since']);
  assert.deepEqual(start['zb-since'], { output: '0 0 0', href: null, classes: 'off', width: '10px', value: '0' }, 'a javascript: URL is not written');

  // A key filter (`onkeydown.enter`): other keys don't count.
  for (const tag of TAGS) {
    await page.focus(`${tag} input.keys`);
    await page.keyboard.press('a');
    await page.keyboard.press('Enter');
  }
  await each(page, "host.querySelector('.up').click(); host.querySelector('.up').click(); host.querySelector('.flip').click();");
  await page.setViewportSize({ width: 500, height: 400 });
  await page.waitForFunction((tags) => tags.every((tag) => !document.querySelector(tag).querySelector('output').textContent.endsWith(' 0')), TAGS);

  const after = await read(page);
  assert.deepEqual(after['zb-since-518'], after['zb-since']);
  assert.equal(after['zb-since'].output.slice(0, 4), '2 1 ', 'two clicks, one Enter');
  assert.deepEqual({ ...after['zb-since'], output: undefined }, { output: undefined, href: 'https://example.com/', classes: 'active big on', width: '20px', value: '2' });
  // The blocked javascript: URL, once for each (development only: the production build is silent).
  assert.ok(messages.every((message) => /blocked an unsafe URL in "href"/.test(message)), messages.join('\n'));
  assert.ok(messages.length === 2 || messages.length === 0, messages.join('\n'));
});

test('a module compiled by 5.18.0 takes over server markup', { skip: runtimeOnly }, async () => {
  const props = join(tmpdir(), 'zb-since-props.json');
  writeFileSync(props, '{}');
  const html = compiler(source, '--props', props, '--partial');
  const both = html + html.replaceAll('zb-since', 'zb-since-518');
  const { page } = await open(both, {
    beforeModules: `window.server = ${JSON.stringify(TAGS)}.map((tag) => document.querySelector(tag + ' button.up'));`,
    modules: ['since-4', 'since-4-518'],
  });
  const kept = await page.evaluate(async (tags) => {
    const result = [];
    for (const [at, tag] of tags.entries()) {
      await document.querySelector(tag).updateComplete;
      result.push(document.querySelector(`${tag} button.up`) === window.server[at]);
    }
    return result;
  }, TAGS);
  assert.deepEqual(kept, [true, true]);
});
