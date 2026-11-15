// The sync server's URL is the request's own: a Host header that isn't a host is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSyncServer, MOUNT } from '../src/server.js';

test("a Host header that isn't a host is a 400, not part of the path", async () => {
  const sync = createSyncServer();
  const handle = (url, headers) => new Promise((resolve) => {
    const res = { writeHead(status) { this.status = status; return this; }, setHeader() {}, write() {}, on() {}, end() { resolve(this.status); } };
    sync.handle({ method: 'GET', url, headers, on() {}, socket: {} }, res).then((ours) => { if (!ours) resolve('not ours'); });
  });
  for (const host of ['h/other', 'h/x?', 'h#', '']) assert.equal(await handle(`${MOUNT}/changes`, { host }), 400, JSON.stringify(host));
});
