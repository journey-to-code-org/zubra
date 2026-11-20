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
import crypto from 'node:crypto';
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

test('a file is compressed once, however its path is spelled, and what is kept has a limit', async () => {
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
    // One file has no end of spellings (%7A is z). Each is the same file, compressed once: a
    // Brotli of the runtime's base takes tens of milliseconds, synchronously, so compressing it
    // again for every new spelling would let anyone keep the server busy (security audit 4).
    const hex = (char) => `%${char.charCodeAt(0).toString(16)}`;
    const spellings = [];
    for (let bits = 1; bits < 256; bits++) spellings.push('/_zubra/runtime/' + [...'zubra.js'].map((char, i) => ((bits >> i) & 1 ? hex(char) : char)).join(''));
    spellings.push(...spellings.map((spelling) => spelling.replace('/runtime/', '/%72untime/')), '/_zubra/runtime/x/../zubra.js');
    for (const spelling of spellings) {
      const response = await ask(spelling, Math.random() < 0.5 ? 'gzip' : 'br');
      assert.equal(response.status, 200, spelling);
      assert.ok(response.headers.get('content-encoding'), spelling);
    }
    assert.equal(gzip.mock.callCount(), 1, 'every spelling is the file already compressed');
    assert.equal(brotli.mock.callCount(), 1, 'every spelling is the file already compressed');
  } finally {
    brotli.mock.restore();
    gzip.mock.restore();
    syncBuiltinESMExports();
  }
});

test('what is kept has a limit: past it, what was kept is let go', async () => {
  // Answers that differ without end: in development, `reload`'s versions of whichever components
  // a page names. 60 components with long names make each answer more than a packet.
  const many = mkdtempSync(join(tmpdir(), 'zubra-compress-many-'));
  const names = Array.from({ length: 60 }, (_, i) => `kept-limit-number-${String(i).padStart(2, '0')}`);
  for (const name of names) writeFileSync(join(many, `${name}.zb`), `<${name}>\n  <p>${name}</p>\n</${name}>\n`);
  const gzip = mock.method(nodeZlib, 'gzipSync');
  syncBuiltinESMExports();
  try {
    const zubra = createZubra({ components: many, production: false, devtools: false, compress: true, reload: true });
    const ask = (list) => zubra.fetch(new Request(`http://x/_zubra/reload/versions/${list.join('+')}`, { headers: { 'accept-encoding': 'gzip' } }));
    // 501 different answers: each list leaves out two of the names.
    const lists = [];
    for (let a = 0; a < names.length && lists.length < 501; a++) for (let b = a + 1; b < names.length && lists.length < 501; b++) lists.push(names.filter((_, i) => i !== a && i !== b));
    for (const list of lists) assert.equal((await ask(list)).headers.get('content-encoding'), 'gzip');
    assert.equal(gzip.mock.callCount(), 501);
    await ask(lists[lists.length - 1]);
    assert.equal(gzip.mock.callCount(), 501, 'the latest is kept');
    await ask(lists[0]);
    assert.equal(gzip.mock.callCount(), 502, 'the first was let go with the rest');
  } finally {
    gzip.mock.restore();
    syncBuiltinESMExports();
    rmSync(many, { recursive: true, force: true });
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

test("at start the runtime's files are compressed off the main thread, and a request before that waits for it", async () => {
  const { brotliCompressSync: brotliNow, gzipSync: gzipNow } = nodeZlib;
  // The compressions started at start are held until the test lets them go.
  const held = [];
  const brotliLater = mock.method(nodeZlib, 'brotliCompress', (body, options, callback) => held.push(() => callback(null, brotliNow(body, options))));
  const gzipLater = mock.method(nodeZlib, 'gzip', (body, options, callback) => held.push(() => callback(null, gzipNow(body, options))));
  const brotli = mock.method(nodeZlib, 'brotliCompressSync');
  const gzip = mock.method(nodeZlib, 'gzipSync');
  syncBuiltinESMExports();
  try {
    const zubra = production({ compress: true });
    await new Promise((done) => setImmediate(done));
    assert.ok(brotliLater.mock.callCount() > 3, `the runtime's files: ${brotliLater.mock.callCount()}`);
    assert.equal(gzipLater.mock.callCount(), brotliLater.mock.callCount());
    assert.equal(brotliLater.mock.calls[0].arguments[1].params[nodeZlib.constants.BROTLI_PARAM_QUALITY], 11);
    // Asked for while its compression runs: the answer waits for it.
    let answered = null;
    const asked = zubra.fetch(new Request(`http://x${BASE}`, { headers: { 'accept-encoding': 'br' } })).then((response) => (answered = response));
    await new Promise((done) => setTimeout(done, 20));
    assert.equal(answered, null, 'it waits');
    for (const release of held.splice(0)) release();
    const response = await asked;
    assert.equal(response.headers.get('content-encoding'), 'br');
    const plain = Buffer.from(await (await production().fetch(new Request(`http://x${BASE}`))).arrayBuffer());
    assert.deepEqual(brotliDecompressSync(Buffer.from(await response.arrayBuffer())), plain);
    const gzipped = await zubra.fetch(new Request(`http://x${BASE}`, { headers: { 'accept-encoding': 'gzip' } }));
    assert.deepEqual(gunzipSync(Buffer.from(await gzipped.arrayBuffer())), plain);
    // Nothing was compressed on the main thread for a request.
    assert.equal(brotli.mock.calls.filter(({ arguments: [body] }) => Buffer.compare(Buffer.from(body), plain) === 0).length, 0);
    assert.equal(gzip.mock.calls.filter(({ arguments: [body] }) => Buffer.compare(Buffer.from(body), plain) === 0).length, 0);
  } finally {
    for (const one of [brotliLater, gzipLater, brotli, gzip]) one.mock.restore();
    syncBuiltinESMExports();
  }
});

test('a runtime file is hashed once, not on every request', async () => {
  const zubra = production({ compress: true });
  const ask = () => zubra.fetch(new Request(`http://x${BASE}`, { headers: { 'accept-encoding': 'gzip' } }));
  await ask();
  const hashes = mock.method(crypto, 'createHash');
  syncBuiltinESMExports();
  try {
    for (let i = 0; i < 5; i++) await ask();
    assert.equal(hashes.mock.callCount(), 0);
  } finally {
    hashes.mock.restore();
    syncBuiltinESMExports();
  }
});

test('send: a page in Brotli or gzip with `compress`, as it is without, and the status and headers it is given', async () => {
  const html = `<!doctype html><html><body>${'<p>A paragraph of the page, more than a packet of it.</p>'.repeat(60)}</body></html>`;
  const sending = (zubra, options) => {
    const server = createServer((request, response) => {
      if (request.url === '/typed') response.setHeader('content-type', 'application/xhtml+xml');
      zubra.send(request, response, request.url === '/small' ? '<p>hi</p>' : html, options);
    });
    servers.push(server);
    return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server.address().port)));
  };
  const port = await sending(production({ compress: true }));
  const br = await get(port, '/', { 'accept-encoding': 'gzip, br' });
  assert.equal(br.status, 200);
  assert.equal(br.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'accept-encoding');
  assert.equal(br.headers['content-length'], String(br.body.length));
  assert.equal(brotliDecompressSync(br.body).toString(), html);
  assert.ok(br.body.length < html.length / 4, `${br.body.length} of ${html.length}`);
  const gz = await get(port, '/', { 'accept-encoding': 'gzip' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(gunzipSync(gz.body).toString(), html);
  const plain = await get(port, '/');
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.headers.vary, 'accept-encoding');
  assert.equal(plain.body.toString(), html);
  // A few bytes go as they are; a content type the response has is kept.
  assert.equal((await get(port, '/small', { 'accept-encoding': 'br' })).headers['content-encoding'], undefined);
  assert.equal((await get(port, '/typed', { 'accept-encoding': 'br' })).headers['content-type'], 'application/xhtml+xml');
  // Without `compress`, the page as it is; the status and headers given go with it.
  const off = await sending(production(), { status: 404, headers: { 'x-page': 'missing' } });
  const asIs = await get(off, '/', { 'accept-encoding': 'br' });
  assert.equal(asIs.status, 404);
  assert.equal(asIs.headers['x-page'], 'missing');
  assert.equal(asIs.headers['content-encoding'], undefined);
  assert.equal(asIs.body.toString(), html);
});
