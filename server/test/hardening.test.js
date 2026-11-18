// What call-store- found serving real data (its docs/zubra-findings.md, on 5.17.0): a streamed
// error's text reaching the visitor, a stream with no end, a failed render that broke the page,
// and prop values that failed far from where they came from. No browser: the page's chunks are
// read as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '../src/index.js';

const components = join(dirname(fileURLToPath(import.meta.url)), 'components');
const LAYOUT = '<!doctype html><html><head></head><body>BODY</body></html>';

/** The whole streamed page, as text. */
async function streamed(page, body) {
  let text = '';
  for await (const chunk of page.chunks(LAYOUT.replace('BODY', body))) text += chunk;
  return text;
}

test('a rejected streamed prop: its message reaches the browser in development only; in production the page gets "Internal error" and onError gets the error', async () => {
  const secret = 'connect ECONNREFUSED 10.0.0.5:5432 (user billing)';
  const failing = () => Promise.reject(new Error(secret));

  const development = createZubra({ components, production: false });
  let page = development.page();
  let text = await streamed(page, page.render('review-list', { reviews: failing() }));
  assert.match(text, /ECONNREFUSED 10\.0\.0\.5/, 'development: the message, to debug with');

  const seen = [];
  const production = createZubra({ components, production: true, onError: (error, where) => seen.push({ message: error.message, ...where }) });
  page = production.page();
  text = await streamed(page, page.render('review-list', { reviews: failing() }));
  assert.doesNotMatch(text, /ECONNREFUSED|10\.0\.0\.5|billing/, 'production: nothing of the error reaches the page');
  assert.match(text, /"reviews":\{"error":"Internal error"\}/);
  assert.deepEqual(seen, [{ message: secret, component: 'review-list', prop: 'reviews' }]);

  // With no onError, the error is logged where the server logs, with its stack.
  const warnings = [];
  const quiet = createZubra({ components, production: true, warn: (message) => warnings.push(message) });
  page = quiet.page();
  await streamed(page, page.render('review-list', { reviews: failing() }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /<review-list>'s prop reviews was rejected: Error: connect ECONNREFUSED[^]*\n\s+at /);
});

test('a streamed prop that never settles is rejected after streamTimeout, and the stream ends', async () => {
  const never = () => new Promise(() => {});
  const seen = [];
  const zubra = createZubra({ components, production: false, streamTimeout: 60_000, onError: (error, where) => seen.push({ message: error.message, ...where }) });
  // The page's own limit, here shorter than the server's.
  const page = zubra.page({ streamTimeout: 50 });
  const started = Date.now();
  const text = await streamed(page, page.render('review-list', { reviews: never() }));
  assert.ok(Date.now() - started < 5_000, 'it ended');
  // (In the script, `<` is written \u003c, as every streamed value is.)
  assert.match(text, /"reviews":\{"error":"@zubra\/server: \\u003creview-list>'s prop reviews didn't settle within 50 ms \(streamTimeout\)"\}/);
  assert.deepEqual(seen, [{ message: "@zubra/server: <review-list>'s prop reviews didn't settle within 50 ms (streamTimeout)", component: 'review-list', prop: 'reviews' }]);

  // The server's limit when the page sets none; a value that arrives in time is unaffected.
  const fast = createZubra({ components, production: false, streamTimeout: 40, warn: () => {} });
  const second = fast.page();
  const late = await streamed(second, second.render('review-list', { reviews: never() }) + second.render('review-list', { reviews: Promise.resolve([{ id: 1, name: 'Ada', stars: 5 }]) }));
  assert.match(late, /within 40 ms/);
  assert.match(late, /"reviews":\{"value":\[\{"id":1,"name":"Ada","stars":5\}\]\}/);
  assert.throws(() => createZubra({ components, streamTimeout: -1 }), /streamTimeout is a number of milliseconds/);
});

test('a render that fails (an unknown component) doesn\'t stop the page from finishing', () => {
  const zubra = createZubra({ components, production: false });
  const page = zubra.page();
  assert.throws(() => page.render('no-such-thing'), /no component "no-such-thing"/);
  const card = page.render('book-card', { book: { title: 'Dune', price: 999 } });
  const html = page.finish(LAYOUT.replace('BODY', card));
  assert.match(html, /book-card/);
  assert.doesNotMatch(html, /no-such-thing/);
});

test('props that JSON can\'t carry are refused naming the component and the prop; a lone surrogate is repaired and reported', () => {
  const warnings = [];
  const zubra = createZubra({ components, production: false, warn: (message) => warnings.push(message) });
  assert.throws(() => zubra.render('count-stepper', { value: NaN }), /^Error: @zubra\/server: <count-stepper>'s prop value is NaN, which JSON can't carry \(it would arrive as null\)\. Pass a finite number, or null for none$/);
  assert.throws(() => zubra.render('count-stepper', { value: -Infinity }), /prop value is -Infinity/);
  assert.throws(() => zubra.render('book-card', { book: { title: 'Dune', price: 10n } }), /<book-card>'s prop book\.price is a BigInt, which JSON can't carry\. Pass it as a number or a string/);
  assert.throws(() => zubra.render('review-list', { reviews: [{ id: 1, name: 'Ada', stars: NaN }] }), /prop reviews\[0\]\.stars is NaN/);

  // Half of an emoji (a stored value cut in the middle): the page still renders, with U+FFFD in
  // its place, and the server says where it was.
  const card = zubra.render('book-card', { book: { title: 'Ada \uD83D', price: 100 } });
  assert.match(card, /Ada �/);
  assert.deepEqual(warnings, ["@zubra/server: <book-card>'s prop book.title has half of a surrogate pair (text cut inside an emoji or another character outside the BMP); it is shown as U+FFFD. Fix the stored text, or call toWellFormed() on it."]);

  // What JSON leaves out as it always has: a function (a framework passes event handlers
  // through props) and undefined; a Date arrives as its ISO string.
  assert.doesNotThrow(() => zubra.render('book-card', { book: { title: 'Dune', price: 1, onBuy() {} } }));
  assert.match(zubra.render('book-card', { book: { title: new Date(0), price: 1 } }), /1970-01-01T00:00:00\.000Z/);
});
