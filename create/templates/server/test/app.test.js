// The app in a real browser: starts the server, opens the page, and uses it with JavaScript
// and without. Run `npx playwright install chromium` once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { server } from '../server.js';

let browser;
let origin;
before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server.close();
});

/** A page of the app; nothing may reach its console as an error. */
async function open(options, use) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  try {
    await page.goto(origin);
    await use(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

test('the page arrives rendered: before any JavaScript, the HTML has the components in it', async () => {
  const html = await (await fetch(origin)).text();
  assert.match(html, /<hello-counter[^>]*>[\s\S]*Clicks: 2[\s\S]*<\/hello-counter>/);
  assert.match(html, /<guest-book[\s\S]*<li>Hello from the server<\/li>/);
  // And the code of the server function isn't in what the browser is sent.
  const module = await (await fetch(`${origin}/_zubra/components/guest-book.js`)).text();
  assert.doesNotMatch(module, /addNote|notes\.js/);
});

test('the counter continues in the browser from what the server rendered', () => open({}, async (page) => {
  await page.waitForFunction(() => customElements.get('hello-counter'));
  await page.click('hello-counter button.more');
  assert.equal(await page.textContent('hello-counter output'), 'Clicks: 3');
}));

test('the guest book: the form runs its server function, and the list follows', () => open({}, async (page) => {
  await page.waitForFunction(() => customElements.get('guest-book'));
  const before = await page.locator('guest-book li').count();
  await page.fill('guest-book input', 'Signed with JavaScript');
  await page.click('guest-book button');
  await page.waitForFunction((count) => document.querySelectorAll('guest-book li').length === count + 1, before);
  assert.equal(await page.textContent('guest-book li:last-child'), 'Signed with JavaScript');
  assert.equal(new URL(page.url()).pathname, '/', 'no navigation');
  // What the function refuses comes back as its return value.
  await page.fill('guest-book input', '   ');
  await page.click('guest-book button');
  await page.waitForFunction(() => document.querySelector('guest-book .gb-said').textContent === 'Write something first.');
}));

test('without JavaScript the same form posts, and the page comes back with the new note', () => open({ javaScriptEnabled: false }, async (page) => {
  const before = await page.locator('guest-book li').count();
  await page.fill('guest-book input', 'Signed without JavaScript');
  await page.click('guest-book button');
  await page.waitForURL(`${origin}/`);
  assert.equal(await page.locator('guest-book li').count(), before + 1);
  assert.equal(await page.textContent('guest-book li:last-child'), 'Signed without JavaScript');
  await page.click('guest-book button');
  await page.waitForURL(`${origin}/`);
  assert.equal(await page.textContent('guest-book .gb-said'), 'Write something first.');
}));

// The guest book keeps the latest notes, not every one: anyone can sign it, and each page shows
// them all. (When the notes move to a database, keep a limit there, or page through them.)
test('the guest book keeps the latest notes, not all of them', async () => {
  const { notes, addNote, KEPT } = await import('../src/notes.js');
  const before = [...notes];
  try {
    for (let i = 0; i < KEPT + 30; i++) addNote(`note ${i}`);
    assert.equal(notes.length, KEPT);
    assert.equal(notes.at(-1), `note ${KEPT + 29}`, 'the newest is kept');
    assert.equal(notes[0], 'note 30', 'the oldest go first');
  } finally {
    notes.splice(0, notes.length, ...before);
  }
});

// The examples on the starter page. When you delete zubra-examples.zb, delete this test with it.
test('the examples work: a list, a form control, async data and slots', () => open({}, async (page) => {
  await page.waitForFunction(() => customElements.get('todo-list') && customElements.get('rating-input') && customElements.get('async-tip'));
  assert.equal(await page.textContent('todo-list .tl-left'), '1 left');
  await page.fill('todo-list form input', 'Write a test');
  await page.click('todo-list form button');
  assert.equal(await page.locator('todo-list li').count(), 3);
  assert.equal(await page.textContent('todo-list .tl-left'), '2 left');

  await page.click('rating-input button:nth-of-type(5)');
  await page.click('zubra-examples form.zx-form > button:not([type])');
  assert.equal(await page.textContent('zubra-examples .zx-sent'), 'stars=5');

  await page.waitForFunction(() => document.querySelector('async-tip p')?.textContent.startsWith('A top-level let'));
  await page.click('async-tip > button');
  await page.waitForFunction(() => document.querySelector('async-tip p')?.textContent.startsWith('A const that'));

  const card = page.locator('example-card', { has: page.locator('h3', { hasText: 'Slots' }) });
  assert.match(await card.locator('.xc-demo').textContent(), /in its default slot/);
  assert.match(await card.locator('footer').textContent(), /slot named note/);
}));
