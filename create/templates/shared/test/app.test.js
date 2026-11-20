// The app in a real browser: builds it, serves the build, clicks the counter and uses each example.
// `npm test` (needs Chromium for Playwright: `npx playwright install chromium`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildApp } from './build.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

/** The built app, served, in Chromium: `use(page)` drives it, and nothing may reach the console as an error. */
async function inBrowser(use) {
  const dist = await buildApp(root);
  const server = createServer((request, response) => {
    let path = join(dist, decodeURIComponent(new URL(request.url, 'http://x').pathname));
    if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
    try {
      response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'text/plain' }).end(readFileSync(path));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await use(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    server.close();
  }
}

test('the counter counts, and the app sees its count', () => inBrowser(async (page) => {
  await page.waitForSelector('hello-counter button.more');
  assert.equal(await page.textContent('hello-counter output'), 'Clicks: 0');
  assert.equal(await page.isDisabled('hello-counter button.less'), true);

  await page.click('hello-counter button.more');
  await page.click('hello-counter button.more');
  // (Playwright's locators look inside shadow roots, as an app's own may be: Lit's.)
  await page.locator('#seen', { hasText: /^2$/ }).waitFor();
  assert.equal(await page.textContent('hello-counter output'), 'Clicks: 2');
  await page.click('hello-counter button.less');
  await page.locator('#seen', { hasText: /^1$/ }).waitFor();
}));

// The examples on the starter page. When you delete zubra-examples.zb, delete this test with it
// and write the same kind of test for your own components.
test('the examples work: a list, a form control, async data and slots', () => inBrowser(async (page) => {
  await page.waitForSelector('zubra-examples todo-list li');
  assert.match(await page.textContent('zubra-welcome h1'), /\S/);

  // Lists, conditions and input: add one, tick it, remove them all.
  assert.equal(await page.textContent('todo-list .tl-left'), '1 left');
  await page.fill('todo-list form input', 'Write a test');
  await page.click('todo-list form button');
  assert.equal(await page.locator('todo-list li').count(), 3);
  assert.equal(await page.textContent('todo-list .tl-left'), '2 left');
  assert.equal(await page.inputValue('todo-list form input'), '');
  await page.check('todo-list li:last-child input');
  assert.equal(await page.textContent('todo-list .tl-left'), '1 left');
  for (let rows = 3; rows > 0; rows--) await page.click('todo-list li:first-child button');
  assert.equal(await page.textContent('todo-list > p:not(.tl-left)'), 'Nothing to do. Add something.');

  // A form control: the form submits the rating under its name, and resets it.
  await page.click('rating-input button:nth-of-type(5)');
  await page.click('zubra-examples form.zx-form button:not([type])');
  assert.equal(await page.textContent('zubra-examples .zx-sent'), 'stars=5');
  await page.click('zubra-examples form.zx-form button[type=reset]');
  await page.click('zubra-examples form.zx-form button:not([type])');
  assert.equal(await page.textContent('zubra-examples .zx-sent'), 'stars=3');

  // Async data: a tip arrives, and asking again brings the next one.
  await page.locator('async-tip p', { hasText: /^A top-level let/ }).waitFor();
  await page.click('async-tip > button');
  await page.locator('async-tip p', { hasText: /^A const that/ }).waitFor();

  // Slots: the card's heading is a prop, its body and note are what the page put inside it.
  const card = page.locator('example-card', { has: page.locator('h3', { hasText: 'Slots' }) });
  assert.match(await card.locator('.xc-demo').textContent(), /in its default slot/);
  assert.match(await card.locator('footer').textContent(), /slot named note/);
}));
