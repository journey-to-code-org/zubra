// The slice's contract: what every implementation must do before it is measured.
// S1-S6: the menu, bag and pickup time. S7-S8: checkout and the live order page.
//   BASE=http://localhost:3101 CONTROL=3199 node --test compare/slice/contract/
// CONTROL is the shared kitchen port (SLICE_CONTROL_PORT) the implementation was started with.
// Start each implementation on a fresh database (SLICE_DB unset is in memory).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3101';
const CONTROL = process.env.CONTROL ?? '3199';
let browser;
before(async () => {
  browser = await chromium.launch();
  // One page first: a build may make its slice (and open the kitchen port) on its first request.
  assert.equal((await fetch(`${BASE}/`)).status, 200, `${BASE} answers`);
});
after(async () => { await browser.close(); });

const phone = async ({ js = true } = {}) => {
  const context = await browser.newContext({ javaScriptEnabled: js, baseURL: BASE });
  return { context, page: await context.newPage() };
};
const stock = async (item, left) => {
  const res = await fetch(`http://127.0.0.1:${CONTROL}/stock?item=${item}&left=${left}`, { method: 'POST' });
  assert.equal(res.status, 200, `the kitchen set ${item} to ${left}`);
};
const row = (page, name) => page.locator('li.item', { has: page.getByRole('heading', { name, exact: true }) });
const add = async (page, name, qty = 1) => {
  await page.getByLabel(`How many ${name}`).fill(String(qty));
  await row(page, name).getByRole('button', { name: 'Add' }).click();
};
const text = async (page) => (await page.locator('main').innerText()).replace(/\s+/g, ' ');

test('S1 the menu shows every section and item, with what is left', async () => {
  const { context, page } = await phone({ js: false });
  await stock('sourdough', 12);
  await page.goto('/');
  await page.getByRole('heading', { name: 'Order ahead', level: 1 }).waitFor();
  for (const section of ['Bread', 'Pastry', 'Coffee']) await page.getByRole('heading', { name: section, level: 2 }).waitFor();
  assert.equal(await page.locator('li.item').count(), 8);
  // Locators, not innerText: they also read an item's shadow root, where a web component may render it.
  const sourdough = row(page, 'Country sourdough');
  for (const words of ['$9.00', 'loaf', '12 left']) await sourdough.getByText(words).first().waitFor();
  assert.equal(await row(page, 'Drip coffee').getByText(/left|Sold out/).count(), 0);
  await context.close();
});

for (const js of [false, true]) {
  test(`S2-S4 add, change, remove and pick a time (JavaScript ${js ? 'on' : 'off'})`, async () => {
    const { context, page } = await phone({ js });
    await page.goto('/');
    await add(page, 'Country sourdough', 2);
    await page.locator('.notice', { hasText: 'Added to your order.' }).waitFor();
    await add(page, 'Butter croissant', 1);
    await page.locator('.notice', { hasText: 'Added to your order.' }).waitFor();
    await page.getByRole('link', { name: /Your order/ }).click();
    await page.getByRole('heading', { name: 'In your bag' }).waitFor();
    assert.match(await text(page), /Country sourdough.*\$18\.00/);
    assert.match(await text(page), /Total \$22\.25/);
    const line = page.locator('li.line', { hasText: 'Country sourdough' });
    await line.getByRole('button', { name: '+' }).click();
    await page.locator('main', { hasText: 'Total $31.25' }).waitFor();
    await page.locator('li.line', { hasText: 'Country sourdough' }).getByRole('button', { name: '−' }).click();
    await page.locator('main', { hasText: 'Total $22.25' }).waitFor();
    await page.locator('li.line', { hasText: 'Butter croissant' }).getByRole('button', { name: 'Remove' }).click();
    await page.locator('main', { hasText: 'Total $18.00' }).waitFor();
    assert.equal(await page.locator('li.line').count(), 1);
    const options = await page.getByLabel('When you’ll come by').locator('option:not([disabled])').allInnerTexts();
    const open = options.filter((o) => /\d/.test(o));
    const pick = open[Math.floor(Math.random() * open.length)];
    await page.getByLabel('When you’ll come by').selectOption({ label: pick });
    await page.getByRole('button', { name: 'Set the time' }).click();
    await page.locator('main', { hasText: `Pickup: ${pick.replace(/^(today|tomorrow) /, '$1 at ')}` }).waitFor();
    await page.reload();
    assert.equal(await page.getByLabel('When you’ll come by').evaluate((select) => select.selectedOptions[0].textContent.trim()), pick);
    await context.close();
  });
}

test('S5 an empty bag says so', async () => {
  const { context, page } = await phone({ js: false });
  await page.goto('/order');
  assert.match(await text(page), /Your bag is empty\./);
  await context.close();
});

test('S5 a sold-out item can\'t be added, even from a page opened before it sold out', async () => {
  await stock('rye', 3);
  const { context, page } = await phone({ js: false });
  await page.goto('/');
  await stock('rye', 0);
  await add(page, 'Seeded rye', 1);
  await page.locator('.notice.problem', { hasText: 'Sold out.' }).waitFor();
  assert.ok(await row(page, 'Seeded rye').getByRole('button', { name: 'Add' }).isDisabled());
  await page.goto('/order');
  assert.match(await text(page), /Your bag is empty\./);
  await context.close();
  await stock('rye', 6);
});

test('S6 the menu is live: the kitchen\'s stock shows on an open page without a reload', async () => {
  await stock('apple-hand-pie', 4);
  const { context, page } = await phone();
  await page.goto('/');
  await row(page, 'Apple hand pie').filter({ hasText: '4 left' }).waitFor();
  await page.waitForTimeout(500); // the live connection open
  await stock('apple-hand-pie', 2);
  await row(page, 'Apple hand pie').filter({ hasText: '2 left' }).waitFor({ timeout: 5000 });
  await stock('apple-hand-pie', 0);
  await row(page, 'Apple hand pie').filter({ hasText: 'Sold out' }).waitFor({ timeout: 5000 });
  assert.ok(await row(page, 'Apple hand pie').getByRole('button', { name: 'Add' }).isDisabled());
  await stock('apple-hand-pie', 4);
  await row(page, 'Apple hand pie').filter({ hasText: '4 left' }).waitFor({ timeout: 5000 });
  assert.ok(await row(page, 'Apple hand pie').getByRole('button', { name: 'Add' }).isEnabled());
  await context.close();
});

// ---- Checkout and the order page ----

const control = async (path) => {
  const res = await fetch(`http://127.0.0.1:${CONTROL}${path}`, { method: 'POST' });
  assert.equal(res.status, 200, `the kitchen did ${path}`);
  return res.json();
};
/** A guest with sourdough in the bag and a pickup time, on the checkout page. */
async function toCheckout(page) {
  await page.goto('/');
  await add(page, 'Country sourdough', 2);
  await page.locator('.notice', { hasText: 'Added to your order.' }).waitFor();
  await page.goto('/order');
  const options = await page.getByLabel('When you’ll come by').locator('option:not([disabled])').allInnerTexts();
  const open = options.filter((o) => /\d/.test(o));
  await page.getByLabel('When you’ll come by').selectOption({ label: open[Math.floor(Math.random() * open.length)] });
  await page.getByRole('button', { name: 'Set the time' }).click();
  await page.getByRole('link', { name: 'Check out' }).click();
  await page.getByRole('heading', { name: 'Check out', level: 1 }).waitFor();
}
const fill = async (page, { name = 'Sam Teets', email = `sam-${Date.now()}@example.com`, card = '4242 4242 4242 4242' } = {}) => {
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Card number').fill(card);
  await page.getByRole('button', { name: /^Place order · \$/ }).click();
};

test('S7 checkout needs a bag and a time: without them it sends the guest back to the bag', async () => {
  const { context, page } = await phone({ js: false });
  await page.goto('/checkout');
  await page.waitForURL(/\/order(\?|$)/);
  assert.match(await text(page), /Your bag is empty\./);
  await context.close();
});

for (const js of [false, true]) {
  test(`S7 checkout says what's wrong, refuses a declined card, then takes the order (JavaScript ${js ? 'on' : 'off'})`, async () => {
    const { context, page } = await phone({ js });
    await toCheckout(page);
    assert.match(await page.locator('p.summary').innerText(), /2 items · \$18\.00 · pickup (today|tomorrow) at/);
    await fill(page, { name: '' });
    await page.locator('.notice.problem', { hasText: 'Give a name for the bag.' }).waitFor();
    await fill(page, { email: 'sam@localhost' }); // the browser accepts it, the server's check doesn't
    await page.locator('.notice.problem', { hasText: 'Give an email we can send the receipt to.' }).waitFor();
    await fill(page, { card: '4000 0000 0000 0002' });
    await page.locator('.notice.problem', { hasText: 'That card was declined. Try another.' }).waitFor();
    assert.doesNotMatch(page.url(), /\/orders\//);
    await fill(page);
    await page.waitForURL(/\/orders\/[a-z0-9]+$/);
    await page.getByRole('heading', { name: /^Order for (today|tomorrow) at / }).waitFor();
    assert.match(await text(page), /For Sam Teets · \$18\.00/);
    assert.match(await page.locator('ul.lines').innerText(), /2 × Country sourdough/);
    assert.equal(await page.locator('ol.steps li.done').count(), 1);
    await page.goto('/order');
    assert.match(await text(page), /Your bag is empty\./);
    await context.close();
  });
}

test('S8 an order is only its guest\'s: another phone, or a made-up key, gets a 404', async () => {
  const owner = await phone({ js: false });
  await toCheckout(owner.page);
  await fill(owner.page);
  await owner.page.waitForURL(/\/orders\//);
  const path = new URL(owner.page.url()).pathname;
  const other = await phone({ js: false });
  const answer = await other.page.goto(path);
  assert.equal(answer.status(), 404);
  await other.page.getByRole('heading', { name: 'We can’t find that order.' }).waitFor();
  assert.equal((await other.page.goto('/orders/cnotarealorder123')).status(), 404);
  await owner.context.close();
  await other.context.close();
});

test('S8 the order page is live: the kitchen moves the order and an open page follows', async () => {
  const { context, page } = await phone();
  await toCheckout(page);
  await fill(page);
  await page.waitForURL(/\/orders\//);
  const key = new URL(page.url()).pathname.split('/').pop();
  await page.waitForTimeout(500); // the live connection open
  await control(`/advance?key=${key}&to=making`);
  await page.locator('ol.steps li.done', { hasText: 'Being made' }).waitFor({ timeout: 5000 });
  await control(`/advance?key=${key}&to=ready`);
  await page.locator('ol.steps li.done', { hasText: 'Ready at the window' }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('ol.steps li.done').count(), 3);
  await context.close();
});
