// Interface 4 beside interface 3: a component compiled now (`$element`, parts that name their
// binder) and the same component compiled by 5.16.0 (`$define`, parts the runtime fills a binder
// in for) render the same DOM through every change. `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useBrowser, open, here } from './harness.js';

const dir = join(here, 'fixtures/interface');
useBrowser({ 'every-block': join(dir, 'every-block.zb') }, { 'every-block-3.js': readFileSync(join(dir, 'every-block-3.js'), 'utf8') });

const content = '<h3 slot="title">Hello</h3><span>inside</span>';

// Both elements' markup, the interface 3 one's tag written as the other's.
// (`settle: false` while a zb-await waits: updateComplete waits for it too.)
const both = (page, settle = true) => page.evaluate(async (settle) => {
  const [now, old] = [document.querySelector('every-block'), document.querySelector('every-block-3')];
  await new Promise((resolve) => setTimeout(resolve));
  if (settle) await Promise.all([now.updateComplete, old.updateComplete]);
  return [now.innerHTML, old.innerHTML.replaceAll('every-block-3', 'every-block')];
}, settle);

test('interface 3 output (5.16.0) and interface 4 output render the same, through every block and slot', async () => {
  const { page, messages } = await open(`<every-block>${content}</every-block><every-block-3>${content}</every-block-3>`, { modules: ['every-block', 'every-block-3'] });
  const source = readFileSync(join(dir, 'every-block-3.js'), 'utf8');
  assert.match(source, /abi: 3,/, 'the checked-in module is interface 3');
  assert.match(source, /export default \$define\(tag/);

  const check = async (what, settle) => {
    const [now, old] = await both(page, settle);
    assert.equal(now, old, what);
    return now;
  };
  const first = await check('first render');
  assert.match(first, /<h3 slot="title"[^>]*>Hello<\/h3>/, 'the named slot has the page\'s heading');
  assert.match(first, /<p>closed<\/p>/);
  assert.match(first, /<span>inside<\/span>/, 'the default slot has the page\'s content');

  // (Ends in `undefined`: evaluate() waits for a promise the code's last value would be.)
  const set = (code) => page.evaluate(`for (const el of document.querySelectorAll('every-block, every-block-3')) { ${code} } undefined`);
  await set("el.open = true; el.items = ['a', 'b', 'c'];");
  assert.match(await check('zb-if switched and rows added'), /<p>open<\/p>[\s\S]*<li>a<\/li>[\s\S]*<li>b<\/li>[\s\S]*<li>c<\/li>/);
  await set("el.items = ['c', 'a'];");
  assert.match(await check('rows moved and removed'), /<li>c<\/li>[\s\S]*<li>a<\/li>/);
  await page.evaluate(() => { window.answer = new Promise((resolve) => { window.settle = resolve; }); });
  await set('el.value = window.answer;');
  assert.match(await check('zb-await pending', false), /<i>waiting<\/i>/);
  await page.evaluate(() => window.settle(42));
  assert.match(await check('zb-await resolved'), /<b>42<\/b>/);
  await set("el.querySelector('[slot=title]').remove();");
  assert.match(await check('the named slot falls back'), /<h2>No title<\/h2>/);

  assert.deepEqual(messages, []);
});
