// `createZubra({ reload: true })` (development): a page reloads when the server is back after
// going away, which is what a restart on a saved file looks like from the browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createZubra } from '../src/index.js';

// Inside the package, so the server it starts finds `../src/index.js`'s packages.
const work = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.tmp-reload-'));
const components = join(work, 'components');
const word = (text) => `<say-word>\n  <p>${text}</p>\n</say-word>\n`;
const serverFile = join(work, 'server.mjs');
let browser;
let child;
before(async () => {
  browser = await chromium.launch();
  writeFileSync(join(work, 'package.json'), '{ "type": "module" }\n');
  (await import('node:fs')).mkdirSync(components);
  writeFileSync(join(components, 'say-word.zb'), word('first'));
  writeFileSync(serverFile, `import { createServer } from 'node:http';
import { createZubra } from ${JSON.stringify(new URL('../src/index.js', import.meta.url).href)};
const zubra = createZubra({ components: ${JSON.stringify(components)}, cache: false, reload: process.env.RELOAD !== 'off' });
createServer((req, res) => {
  if (zubra.handle(req, res)) return;
  const page = zubra.page();
  res.writeHead(200, { 'content-type': 'text/html' }).end(page.finish('<!doctype html><html><head><title>t</title></head><body>' + page.render('say-word') + '</body></html>'));
}).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('up'));
`);
});
after(async () => {
  child?.kill();
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
});
const start = (port, env = {}) =>
  new Promise((resolve, reject) => {
    child = spawn(process.execPath, [serverFile], { env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', (chunk) => String(chunk).includes('up') && resolve());
    child.on('error', reject);
  });
const stop = () => new Promise((resolve) => { child.once('exit', resolve); child.kill(); });
/** A port nothing is using now (the server under test is another process, and must get the same one back). */
const freePort = () => new Promise((resolve) => { const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const production = (options = {}) => createZubra({ components, production: true, ...options });

test('off by default: no script in the page, no stream, no file', async () => {
  const zubra = production();
  const page = zubra.page();
  const html = page.finish(`<html><head></head><body>${page.render('say-word')}</body></html>`);
  assert.doesNotMatch(html, /reload\.js/);
  assert.doesNotMatch(page.scripts(), /reload\.js/);
  // Neither address is the server's then: the app's own routes answer, as for any other path.
  assert.equal(await zubra.fetch(new Request('http://x/_zubra/reload.js')), null);
  assert.equal(await zubra.fetch(new Request('http://x/_zubra/reload')), null);
});

test('on: finish() and scripts() add the script, by the prefix and with the page\'s nonce; the file is served', async () => {
  const zubra = production({ reload: true, prefix: '/assets/z' });
  const page = zubra.page({ nonce: 'abc123' });
  const html = page.finish(`<html><head></head><body>${page.render('say-word')}</body></html>`);
  assert.match(html, /<script src="\/assets\/z\/reload\.js" async nonce="abc123"><\/script><\/body>/);
  assert.match(page.scripts(), /<script src="\/assets\/z\/reload\.js" async nonce="abc123"><\/script>$/);
  // A page with no component gets it too: it is the page that reloads.
  assert.match(zubra.page().finish('<html><head></head><body><p>plain</p></body></html>'), /<script src="\/assets\/z\/reload\.js" async><\/script><\/body>/);
  const file = await zubra.fetch(new Request('http://x/assets/z/reload.js'));
  assert.equal(file.status, 200);
  assert.match(file.headers.get('content-type'), /^text\/javascript/);
  const code = await file.text();
  assert.match(code, /new EventSource\(url\)/);
  assert.match(code, /\("\/assets\/z\/reload"\)$/);
});

test('the stream: an event stream that stays open and says when to ask again, from handle and from fetch', async () => {
  const zubra = production({ reload: true });
  const response = await zubra.fetch(new Request('http://x/_zubra/reload'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'retry: 300\n\n');
  const next = await Promise.race([reader.read().then(() => 'ended'), new Promise((resolve) => setTimeout(() => resolve('open'), 150))]);
  assert.equal(next, 'open');
  await reader.cancel();
  // With `compress` too: the stream is not a file to encode.
  const both = production({ reload: true, compress: true });
  assert.equal((await both.fetch(new Request('http://x/_zubra/reload', { headers: { 'accept-encoding': 'br' } }))).headers.get('content-type'), 'text/event-stream');

  const port = await freePort();
  await start(port);
  try {
    const got = await new Promise((resolve, reject) => {
      const asking = httpRequest({ host: '127.0.0.1', port, path: '/_zubra/reload' }, (answer) => {
        answer.once('data', (chunk) => { resolve({ status: answer.statusCode, type: answer.headers['content-type'], first: String(chunk) }); asking.destroy(); });
      }).on('error', reject);
      asking.end();
    });
    assert.deepEqual(got, { status: 200, type: 'text/event-stream', first: 'retry: 300\n\n' });
  } finally {
    await stop();
  }
});

test('a browser: the server stops and comes back with an edit, and the page shows it without being touched', async () => {
  writeFileSync(join(components, 'say-word.zb'), word('first'));
  const port = await freePort();
  await start(port);
  const tab = await browser.newPage();
  try {
    await tab.goto(`http://127.0.0.1:${port}/`);
    assert.equal(await tab.locator('say-word p').innerText(), 'first');
    await tab.evaluate(() => { window.untouched = true; });
    // While the server stays up, nothing reloads.
    await tab.waitForTimeout(700);
    assert.equal(await tab.evaluate(() => window.untouched), true);
    await stop();
    writeFileSync(join(components, 'say-word.zb'), word('second'));
    await start(port);
    await tab.locator('say-word p', { hasText: 'second' }).waitFor({ timeout: 8000 });
    assert.equal(await tab.evaluate(() => window.untouched), undefined, 'a new page');
  } finally {
    await tab.close();
    await stop();
  }
});

test('without the option the same page stays as it was', async () => {
  writeFileSync(join(components, 'say-word.zb'), word('first'));
  const port = await freePort();
  await start(port, { RELOAD: 'off' });
  const tab = await browser.newPage();
  try {
    await tab.goto(`http://127.0.0.1:${port}/`);
    await stop();
    writeFileSync(join(components, 'say-word.zb'), word('second'));
    await start(port, { RELOAD: 'off' });
    await tab.waitForTimeout(1500);
    assert.equal(await tab.locator('say-word p').innerText(), 'first');
  } finally {
    await tab.close();
    await stop();
  }
});
