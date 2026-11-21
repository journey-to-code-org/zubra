// The DevTools hook (`globalThis.__ZUBRA_DEVTOOLS__`): what the browser extension reads. The
// components are compiled with `--devtools`, as @zubra/unplugin does in Vite's dev server, except
// dt-plain, which shows what an ordinary build still gives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useBrowser, open, here, repo, production, compiler, emitElement, engine } from './harness.js';

const skip = (production && 'the production build has no DevTools hook')
  || (emitElement && '--emit element output has no runtime to hook');
const fixture = (name) => join(here, 'fixtures/devtools', `${name}.zb`);

// The extension's pane (editors/devtools), served beside the page, for the end-to-end test.
const extension = (name) => () => readFileSync(join(repo, 'editors/devtools', name), 'utf8');

useBrowser({ 'dt-plain': fixture('dt-plain') }, production || emitElement ? {} : {
  'dt-panel.js': () => compiler(fixture('dt-panel'), '--emit', 'js', '--devtools'),
  'dt-badge.js': () => compiler(fixture('dt-badge'), '--emit', 'js', '--devtools'),
  'pane.js': extension('pane.js'),
  'render.js': extension('render.js'),
});

/** Open the fixture page and connect, as the extension does. */
async function connected(body = '<dt-panel></dt-panel>', modules = ['dt-panel']) {
  const opened = await open(body, { modules });
  await opened.page.evaluate(() => globalThis.__ZUBRA_DEVTOOLS__.connect());
  await opened.page.waitForFunction(() => globalThis.__ZUBRA_DEVTOOLS__.ready === true);
  const inspect = (selector) => opened.page.evaluate(async (selector) => {
    await document.querySelector('dt-panel, dt-plain').updateComplete;
    return globalThis.__ZUBRA_DEVTOOLS__.inspect(document.querySelector(selector));
  }, selector);
  return { ...opened, inspect };
}

const named = (list, name) => list.find((item) => item.name === name)?.value;
const onNode = (result) => result.bindings.filter((binding) => binding.here);

test('a node maps to its component, file and line, with its props and state by name', { skip }, async () => {
  const { page, messages, inspect } = await connected();
  const result = await inspect('dt-panel p');
  assert.equal(result.version, 1);
  assert.equal(result.component.tag, 'dt-panel');
  assert.ok(result.component.file.replaceAll('\\', '/').endsWith('fixtures/devtools/dt-panel.zb'), result.component.file);
  assert.deepEqual(result.component.at, { line: 8, column: 1 });
  assert.equal(named(result.props, 'label'), '"Panel"');
  assert.equal(named(result.state, 'count'), '0');
  assert.equal(named(result.state, 'doubled'), '0');
  assert.equal(named(result.state, 'items'), '[{text: "a", done: false}]');
  assert.deepEqual(onNode(result), [{
    operation: 'textContent = …', target: '<p.double>', at: { line: 11, column: 21 },
    dependsOn: ['doubled'], ranLast: false, because: [], here: true,
  }]);
  assert.deepEqual(messages, []);
  await page.close();
});

test('a binding depends on the named signals behind it, through rows and properties', { skip }, async () => {
  const { page, inspect } = await connected();
  const li = onNode(await inspect('dt-panel li'));
  assert.deepEqual(li.map(({ operation, at, dependsOn }) => ({ operation, at, dependsOn })), [
    { operation: "classList.toggle('done', …)", at: { line: 14, column: 11 }, dependsOn: ['items[0].done'] },
    { operation: 'textContent = …', at: { line: 14, column: 34 }, dependsOn: ['items[0].text'] },
  ]);
  const button = onNode(await inspect('dt-panel button.inc'));
  assert.deepEqual(button.map(({ operation, dependsOn }) => ({ operation, dependsOn })), [
    { operation: "addEventListener('click', …)", dependsOn: [] },
    { operation: 'textContent = …', dependsOn: ['label', 'count'] },
  ]);
  await page.close();
});

test('the last update says what was written and which bindings re-ran', { skip }, async () => {
  const { page, inspect } = await connected();
  const before = await inspect('dt-panel p');
  await page.click('button.inc');
  const after = await inspect('dt-panel p');
  assert.equal(after.lastUpdate.number, before.lastUpdate.number + 1);
  assert.equal(await page.evaluate(() => globalThis.__ZUBRA_DEVTOOLS__.updates), after.lastUpdate.number, 'the counter the pane polls');
  assert.deepEqual(after.lastUpdate.written, ['count']);
  assert.equal(onNode(after)[0].ranLast, true, 'the <p> showed doubled, which changed');
  assert.equal(after.bindings.find((binding) => binding.target === '<li.done>' || binding.operation.startsWith('classList')).ranLast, false, 'the rows did not');
  assert.equal(named(after.state, 'doubled'), '2');

  await page.click('button.add');
  const added = await inspect('dt-panel ul');
  assert.ok(added.lastUpdate.written.length > 0 && added.lastUpdate.written.every((name) => name.startsWith('items')), added.lastUpdate.written.join());
  assert.equal(added.bindings.find((binding) => binding.operation.startsWith('zb-each')).ranLast, true);
  await page.close();
});

test('writes count from connecting, for elements that were there before it', { skip }, async () => {
  // The page runs before the pane connects; the first thing after connecting is a click, with
  // no inspect in between.
  const { page, inspect } = await connected();
  await page.click('button.inc');
  const after = await inspect('dt-panel p');
  assert.deepEqual(after.lastUpdate.written, ['count']);
  await page.close();
});

test('a form control\'s live state is named as the property the runtime sets', { skip }, async () => {
  const { page, inspect } = await connected();
  assert.deepEqual(onNode(await inspect('dt-panel input.live:not([type])')).map(({ operation }) => operation), ['.value = …']);
  assert.deepEqual(onNode(await inspect('dt-panel input.live[type=checkbox]')).map(({ operation }) => operation), ['.checked = …']);
  await page.close();
});

test('a child component shows what its parent binds onto it', { skip }, async () => {
  const { page, inspect } = await connected();
  await page.click('button.inc');
  const badge = await inspect('dt-badge');
  assert.equal(badge.component.tag, 'dt-badge');
  assert.equal(named(badge.props, 'value'), '1');
  assert.equal(badge.setBy.tag, 'dt-panel');
  assert.deepEqual(badge.setBy.bindings.map(({ operation, at, dependsOn }) => ({ operation, at, dependsOn })), [
    { operation: '.value = …', at: { line: 17, column: 13 }, dependsOn: ['count'] },
  ]);
  await page.close();
});

test('an ordinary build still shows the component, unlocated', { skip }, async () => {
  const { page, inspect } = await connected('<dt-plain></dt-plain>', ['dt-plain']);
  const result = await inspect('dt-plain button');
  assert.equal(result.component.tag, 'dt-plain');
  assert.equal(result.component.located, false);
  assert.deepEqual(result.state, []);
  assert.deepEqual(onNode(result).map(({ operation, at }) => ({ operation, at })), [
    { operation: "addEventListener('click', …)", at: null },
    { operation: 'textContent = …', at: null },
  ]);
  await page.close();
});

test('a node outside any component has none', { skip }, async () => {
  const { page } = await connected('<p id="outside">x</p><dt-panel></dt-panel>');
  const result = await page.evaluate(() => globalThis.__ZUBRA_DEVTOOLS__.inspect(document.getElementById('outside')));
  assert.equal(result.component, null);
  await page.close();
});

test('the extension\'s pane, on a live page: the selection, Open in editor, and following updates', { skip }, async () => {
  // The pane runs in the page itself, with a stand-in for chrome.devtools whose eval runs the
  // pane's code here, as inspectedWindow.eval would in the inspected page (with $0 the selection).
  const { page, messages } = await open('<dt-panel></dt-panel><main id="pane"></main>', {
    beforeModules: `
      await import('/dt-panel.js');
      const selection = [];
      window.select = (selector) => { window.$0 = document.querySelector(selector); selection.forEach((listener) => listener()); };
      window.chrome = { devtools: {
        inspectedWindow: { eval: (code, callback) => { try { callback((0, eval)(code.replaceAll('$0', 'window.$0'))); } catch (error) { callback(undefined, { value: String(error) }); } } },
        panels: { themeName: 'default', elements: { onSelectionChanged: { addListener: (listener) => selection.push(listener) } } },
      } };
    `,
    modules: ['pane'],
  });
  const opened = [];
  await page.route('**/__open-in-editor*', (route) => { opened.push(new URL(route.request().url()).searchParams.get('file')); route.fulfill({ status: 200, body: '' }); });
  const pane = () => page.$eval('#pane', (main) => main.textContent.replace(/\s+/g, ' '));

  await page.evaluate(() => window.select('dt-panel p'));
  await page.waitForFunction(() => document.querySelector('#pane h1')?.textContent === '<dt-panel>');
  assert.match(await pane(), /On this node textContent = … <p\.double> line 11 reads doubled/);

  await page.click('#pane button[data-line="11"]');
  await page.waitForFunction(() => window.performance.getEntriesByType('resource').some((entry) => entry.name.includes('__open-in-editor')));
  assert.equal(opened.length, 1);
  assert.match(opened[0].replaceAll('\\', '/'), /fixtures\/devtools\/dt-panel\.zb:11:21$/);

  // A new selection is said in the status line, not by reading the whole pane out.
  await page.waitForFunction(() => document.querySelector('#pane-status')?.textContent === 'Inspecting <dt-panel>');
  assert.equal(await page.$eval('#pane-status', (el) => el.getAttribute('role')), 'status');
  assert.equal(await page.$eval('#pane', (el) => el.hasAttribute('aria-live')), false);

  // The page updates; the pane follows (it polls the update counter while visible), keeping
  // the focused button and the sections the reader closed, and says only what changed.
  await page.focus('#pane button[data-line="11"]');
  const button = await page.$('#pane button[data-line="11"]');
  await page.$eval('#pane details:has(.signals)', (details) => { details.open = false; });
  await page.evaluate(() => document.querySelector('dt-panel button.inc').click());
  await page.waitForFunction(() => document.querySelector('#pane')?.textContent.includes('wrote count'), null, { timeout: 5000 });
  assert.equal(await page.evaluate((el) => el.isConnected && document.activeElement === el, button), true, 'focus stays on the same button');
  assert.equal(await page.$eval('#pane details:has(.signals)', (details) => details.open), false);
  await page.waitForFunction(() => /^Update 1: \d+ of this component's bindings? re-ran$/.test(document.querySelector('#pane-status')?.textContent), null, { timeout: 5000 });
  await page.$eval('#pane details:has(.signals)', (details) => { details.open = true; });
  assert.match(await pane(), /On this node textContent = …\s*ran <p\.double>/);
  // Why it re-ran, the component's signals, the live counts and the page's updates.
  assert.match(await pane(), /re-ran because doubled ← count changed/);
  assert.match(await pane(), /Signals \(4\) ?label ?prop/);
  assert.match(await pane(), /doubled ?computed ?(changed 1× )?2 reads count read by textContent = … on <p\.double>/);
  assert.match(await pane(), /Live ?\d+ effects in this component · 2 components on the page · \d+ effects alive of those made since the pane connected/);
  assert.match(await pane(), /Updates \(1\) ?1 ?[\d.]+ ms wrote <dt-panel> count 0 → 1/);
  assert.deepEqual(messages, []);
  await page.close();
});

test('a page can open a location itself: open() asks it first', { skip }, async () => {
  const { page } = await connected();
  const requests = [];
  page.on('request', (request) => { if (request.url().includes('__open-in-editor')) requests.push(request.url()); });
  const opened = await page.evaluate(async () => {
    let seen = null;
    const listener = (event) => { seen = event.detail; event.preventDefault(); };
    addEventListener('zubra:open', listener);
    const handled = await globalThis.__ZUBRA_DEVTOOLS__.open('/x/dt-panel.zb', 11, 21);
    removeEventListener('zubra:open', listener);
    return { handled, seen };
  });
  assert.deepEqual(opened, { handled: true, seen: { file: '/x/dt-panel.zb', line: 11, column: 21 } });
  assert.deepEqual(requests, [], 'no request to the dev server when the page handled it');
  await page.close();
});

test('the production build installs no hook', { skip: !production && 'runs with ZUBRA_RUNTIME=production' }, async () => {
  const { page } = await open('<dt-plain></dt-plain>', { modules: ['dt-plain'] });
  assert.equal(await page.evaluate(() => typeof globalThis.__ZUBRA_DEVTOOLS__), 'undefined');
  await page.close();
});

test('a binding that re-ran says why: what it reads that the update wrote, through computeds', { skip }, async () => {
  const { page, inspect } = await connected();
  await page.click('button.inc');
  const after = await inspect('dt-panel button.inc');
  const text = onNode(after).find((binding) => binding.operation === 'textContent = …');
  assert.deepEqual(text.because, ['count'], 'the button reads count itself');
  const p = onNode(await inspect('dt-panel p'))[0];
  assert.deepEqual(p.because, ['doubled ← count'], 'the <p> reads doubled, which reads count');
  const row = after.bindings.find((binding) => binding.operation.startsWith('classList'));
  assert.deepEqual([row.ranLast, row.because], [false, []], "a binding that didn't re-run has no cause");
  await page.click('button.add');
  const added = (await inspect('dt-panel ul')).bindings.find((binding) => binding.operation.startsWith('zb-each'));
  assert.ok(added.because.length && added.because.every((name) => name.startsWith('items')), added.because.join());
  await page.close();
});

test("the component's signals: values, changes, what reads them and what they read", { skip }, async () => {
  const { page, inspect, } = await connected();
  await page.click('button.inc');
  await page.click('button.inc');
  const { signals } = await inspect('dt-panel p');
  const of = (name) => signals.find((signal) => signal.name === name);
  assert.deepEqual(signals.map(({ name, kind }) => `${kind} ${name}`), ['prop label', 'state count', 'state items', 'computed doubled']);
  assert.equal(of('count').value, '2');
  if (process.env.ZUBRA_ENGINE === 'signals') assert.equal(of('count').changes, null, 'the proposal keeps no count');
  else {
    assert.equal(of('count').changes, 2);
    assert.equal(of('doubled').changes, 2, 'two new values after its first (0 → 2 → 4)');
    assert.equal(of('items').changes, 0);
  }
  assert.deepEqual(of('doubled').reads, ['count']);
  assert.ok(of('doubled').readBy.includes('textContent = … on <p.double>'), of('doubled').readBy.join(' | '));
  assert.ok(of('count').readBy.includes('textContent = … on <button.inc>'), of('count').readBy.join(' | '));
  assert.ok(of('count').readBy.includes('doubled'), 'a computed reading it, by name');
  assert.equal(of('count').readers, of('count').readBy.length);
  await page.close();
});

test('the timeline: each update, what it wrote (from and to), what it re-ran, how long it took', { skip }, async () => {
  const { page, inspect } = await connected();
  await page.click('button.inc');
  await page.click('button.add');
  const { timeline } = await inspect('dt-panel p');
  const [inc, add] = timeline.slice(-2);
  assert.equal(add.number, inc.number + 1);
  // The click wrote count, and the panel passed it on to its badge in the same update.
  assert.deepEqual(inc.written, [{ name: '<dt-panel> count', from: '0', to: '1' }, { name: '<dt-badge> value', from: '0', to: '1' }]);
  assert.ok(inc.reran.includes('<dt-panel> textContent = … on <p.double>'), inc.reran.join(' | '));
  assert.equal(inc.ran, inc.reran.length);
  assert.ok(typeof inc.took === 'number' && inc.took >= 0);
  // A write inside the array: named by its path, with the value there now (not the engine's
  // counter behind it).
  assert.ok(add.written.length && add.written.every((write) => write.name?.startsWith('<dt-panel> items') && write.from === null), JSON.stringify(add.written));
  const length = add.written.find((write) => write.name === '<dt-panel> items.length');
  if (length) assert.equal(length.to, '2');
  assert.ok(add.written.some((write) => write.to.includes('text: "b"')), JSON.stringify(add.written));
  await page.close();
});

test('live counts: effects in the component and on the page, and how they moved', { skip }, async () => {
  const { page, inspect } = await connected();
  const before = (await inspect('dt-panel p')).live;
  // The page's count is of what was made since the pane connected: the panel came before it.
  assert.ok(before.component > 5 && before.page < before.component, JSON.stringify(before));
  assert.equal(before.components, 2, 'the panel and its badge');
  await page.click('button.add'); // a row more: its bindings are effects
  const after = (await inspect('dt-panel p')).live;
  assert.ok(after.component > before.component && after.page > before.page, JSON.stringify({ before, after }));
  assert.deepEqual(after.history.at(-1), { update: (await inspect('dt-panel p')).update, effects: after.page });
  // Another panel adds its effects; once it's removed and collected, they leave the count. (A
  // removed element's effects are paused, not disposed: it may come back.)
  const page1 = () => page.evaluate(() => globalThis.__ZUBRA_DEVTOOLS__.inspect(document.querySelector('dt-panel p')).live.page);
  const alone = await page1();
  await page.evaluate(async () => {
    const extra = document.createElement('dt-panel');
    extra.id = 'extra';
    document.body.append(extra);
    await extra.updateComplete;
  });
  const withExtra = await page1();
  assert.ok(withExtra > alone, `${alone} → ${withExtra}`);
  const components = () => page.evaluate(() => globalThis.__ZUBRA_DEVTOOLS__.inspect(document.querySelector('dt-panel p')).live.components);
  assert.equal(await components(), 4, 'two panels, each with its badge');
  await page.evaluate(() => document.getElementById('extra').remove());
  assert.equal(await components(), 2, 'a removed one is no longer on the page, collected or not');
  // Forcing a collection needs Chromium's DevTools protocol.
  if (engine !== 'chromium') return page.close();
  const client = await page.context().newCDPSession(page);
  let now = withExtra;
  for (let tries = 0; tries < 50 && now !== alone; tries++) {
    await client.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(50);
    now = await page1();
  }
  assert.equal(now, alone, `${alone} → ${withExtra} → ${now}`);
  await page.close();
});
