// `createZubra({ compress: true })`: what `handle` and `fetch` answer goes out in Brotli or gzip
// when the request reads one, compressed once per file. Off by default: nothing changes.
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import nodeZlib, { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { chromium } from 'playwright';
import { createZubra } from '../src/index.js';

const components = mkdtempSync(join(tmpdir(), 'zubra-compress-'));
const counter = (word) => `<script>\n  let count = 0\n</script>\n<tap-count label="${word}">\n  <button onclick={() => count++}>{label}</button> <output>{count}</output>\n  <p>${'A line of text to make the module more than a packet. '.repeat(30)}</p>\n</tap-count>\n`;
writeFileSync(join(components, 'tap-count.zb'), counter('Taps'));
// A module of a few bytes: not worth an encoding.
writeFileSync(join(components, 'tiny.js'), 'export const tiny = 1;\n');
writeFileSync(join(components, 'uses-tiny.zb'), "<script>\n  import { tiny } from './tiny.js'\n</script>\n<uses-tiny>\n  <output>{tiny}</output>\n</uses-tiny>\n");

const BASE = '/_zubra/runtime/zubra.js';
const servers = [];
let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  for (const server of servers) server.close();
  rmSync(components, { recursive: true, force: true });
});
async function serving(zubra, html = '') {
  const server = createServer((request, response) => {
    if (zubra.handle(request, response)) return;
    response.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  servers.push(server);
  return server.address().port;
}
/** A GET with exactly these headers (fetch would add its own accept-encoding and decode). */
const get = (port, path, headers = {}) =>
  new Promise((resolve, reject) => {
    httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    })
      .on('error', reject)
      .end();
  });
const production = (options = {}) => createZubra({ components, production: true, ...options });

test('off by default: the file as it is, whatever the request reads', async () => {
  const port = await serving(production());
  const plain = await get(port, BASE, { 'accept-encoding': 'br, gzip' });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, undefined);
  assert.match(plain.body.toString(), /customElements/);
  const response = await production().fetch(new Request(`http://x${BASE}`, { headers: { 'accept-encoding': 'br' } }));
  assert.equal(response.headers.get('content-encoding'), null);
});

test('handle: Brotli when the request reads it, else gzip, else the file; the same text each way', async () => {
  const port = await serving(production({ compress: true }));
  const plain = await get(port, BASE);
  assert.equal(plain.headers['content-encoding'], undefined);
  // A cache between must keep the answers apart, the plain one too.
  assert.equal(plain.headers.vary, 'accept-encoding');

  const br = await get(port, BASE, { 'accept-encoding': 'gzip, deflate, br, zstd' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'accept-encoding');
  assert.equal(br.headers['content-length'], String(br.body.length));
  assert.equal(br.headers['content-type'], plain.headers['content-type']);
  assert.equal(br.headers['cache-control'], plain.headers['cache-control']);
  assert.deepEqual(brotliDecompressSync(br.body), plain.body);
  assert.ok(br.body.length < plain.body.length * 0.4, `${br.body.length} of ${plain.body.length}`);

  const gzip = await get(port, BASE, { 'accept-encoding': 'gzip, deflate' });
  assert.equal(gzip.headers['content-encoding'], 'gzip');
  assert.deepEqual(gunzipSync(gzip.body), plain.body);
  assert.ok(br.body.length < gzip.body.length, 'Brotli is the smaller');

  // q=0 refuses an encoding; an encoding we don't write is no reason to pick one.
  assert.equal((await get(port, BASE, { 'accept-encoding': 'br;q=0, gzip;q=0.5' })).headers['content-encoding'], 'gzip');
  assert.equal((await get(port, BASE, { 'accept-encoding': 'BR' })).headers['content-encoding'], 'br');
  assert.equal((await get(port, BASE, { 'accept-encoding': 'identity, zstd, br;q=0, gzip;q=0.0' })).headers['content-encoding'], undefined);
});

test('a few bytes and an error are sent as they are', async () => {
  const zubra = production({ compress: true, gaps: 'ignore' });
  zubra.page().render('uses-tiny');
  const port = await serving(zubra);
  const tiny = await get(port, '/_zubra/components/tiny.js', { 'accept-encoding': 'br' });
  assert.equal(tiny.status, 200);
  assert.equal(tiny.headers['content-encoding'], undefined);
  assert.equal(tiny.body.toString(), 'export const tiny = 1;\n');
  const missing = await get(port, '/_zubra/components/no-such.js', { 'accept-encoding': 'br' });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers['content-encoding'], undefined);
  assert.equal(missing.body.toString(), 'Not found');
});

test('fetch: the same, as a Response', async () => {
  const zubra = production({ compress: true });
  const plain = Buffer.from(await (await zubra.fetch(new Request(`http://x${BASE}`))).arrayBuffer());
  const response = await zubra.fetch(new Request(`http://x${BASE}`, { headers: { 'accept-encoding': 'gzip, br' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'br');
  assert.equal(response.headers.get('vary'), 'accept-encoding');
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  assert.deepEqual(brotliDecompressSync(Buffer.from(await response.arrayBuffer())), plain);
  assert.equal(await zubra.fetch(new Request('http://x/elsewhere', { headers: { 'accept-encoding': 'br' } })), null);
});

test('a file is compressed once, and what is kept has a limit', async () => {
  const brotli = mock.method(nodeZlib, 'brotliCompressSync');
  const gzip = mock.method(nodeZlib, 'gzipSync');
  syncBuiltinESMExports();
  try {
    const zubra = production({ compress: true });
    const ask = (path, encoding) => zubra.fetch(new Request(`http://x${path}`, { headers: { 'accept-encoding': encoding } }));
    for (let i = 0; i < 3; i++) await ask(BASE, 'br');
    assert.equal(brotli.mock.callCount(), 1);
    // What stays until a restart gets the smallest encoding.
    assert.equal(brotli.mock.calls[0].arguments[1].params[nodeZlib.constants.BROTLI_PARAM_QUALITY], 11);
    for (let i = 0; i < 3; i++) await ask(BASE, 'gzip');
    assert.equal(gzip.mock.callCount(), 1);
    assert.equal(gzip.mock.calls[0].arguments[1].level, 9);
    await ask(BASE, 'br');
    assert.equal(brotli.mock.callCount(), 1, 'both encodings of a file are kept');
    // One file has no end of spellings (%7A is z): past the limit, what was kept is let go.
    const hex = (char) => `%${char.charCodeAt(0).toString(16)}`;
    const distinct = [];
    for (let bits = 1; bits < 256; bits++) distinct.push('/_zubra/runtime/' + [...'zubra.js'].map((char, i) => ((bits >> i) & 1 ? hex(char) : char)).join(''));
    const more = distinct.map((spelling) => spelling.replace('/runtime/', '/%72untime/'));
    for (const spelling of [...distinct, ...more]) assert.equal((await ask(spelling, 'gzip')).headers.get('content-encoding'), 'gzip', spelling);
    const before = gzip.mock.callCount();
    assert.equal(before, 1 + 510);
    await ask(BASE, 'gzip');
    assert.equal(gzip.mock.callCount(), before + 1, 'the first spelling was let go with the rest');
  } finally {
    brotli.mock.restore();
    gzip.mock.restore();
    syncBuiltinESMExports();
  }
});

test('in development an edit is what goes out, with a quick encoding', async () => {
  const brotli = mock.method(nodeZlib, 'brotliCompressSync');
  syncBuiltinESMExports();
  try {
    const zubra = createZubra({ components, production: false, devtools: false, compress: true });
    const ask = async () => brotliDecompressSync(Buffer.from(await (await zubra.fetch(new Request('http://x/_zubra/components/tap-count.js', { headers: { 'accept-encoding': 'br' } }))).arrayBuffer())).toString();
    assert.match(await ask(), /Taps/);
    assert.equal(brotli.mock.calls[0].arguments[1].params[nodeZlib.constants.BROTLI_PARAM_QUALITY], 4);
    writeFileSync(join(components, 'tap-count.zb'), counter('Presses'));
    const later = new Date(Date.now() + 5000);
    utimesSync(join(components, 'tap-count.zb'), later, later);
    const edited = await ask();
    assert.match(edited, /Presses/);
    assert.doesNotMatch(edited, /Taps/);
  } finally {
    brotli.mock.restore();
    syncBuiltinESMExports();
    writeFileSync(join(components, 'tap-count.zb'), counter('Taps'));
  }
});

test('a browser loads the page from compressed modules', async () => {
  const zubra = production({ compress: true });
  const one = zubra.page();
  const html = one.finish(`<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body>${one.render('tap-count')}</body></html>`);
  const port = await serving(zubra, html);
  const page = await browser.newPage();
  const encodings = {};
  page.on('response', (response) => {
    if (response.url().includes('/_zubra/')) encodings[new URL(response.url()).pathname] = response.headers()['content-encoding'];
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.locator('tap-count button').click();
  await assert.doesNotReject(page.locator('tap-count output', { hasText: '1' }).waitFor({ timeout: 5000 }));
  assert.equal(encodings[BASE], 'br');
  assert.equal(encodings['/_zubra/components/tap-count.js'], 'br');
  await page.close();
});
