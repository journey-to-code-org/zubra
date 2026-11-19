// The WebRTC mesh's bookkeeping: rooms that peers have left are forgotten. (The channels
// themselves are covered in browser.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryObjects } from 'node:v8';
import { mesh } from '../src/webrtc.js';

/** Enough of RTCPeerConnection for a peer to be met: nothing ever connects. */
class Connection {
  addEventListener() {}
  createDataChannel() { return { addEventListener() {}, readyState: 'connecting' }; }
  createOffer() { return new Promise(() => {}); }
  close() {}
}

test("rooms a peer has left aren't kept, nor rooms only heard leaving", () => {
  const real = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = Connection;
  try {
    const net = mesh({ self: 'me', signal() {}, deliver() {} });
    const count = () => queryObjects(Set, { format: 'count' });
    const before = count();
    for (let i = 0; i < 500; i++) {
      net.sawPeer(`room-${i}`, 'them', { here: true });
      net.sawPeer(`room-${i}`, 'them', null);
      net.sawPeer(`gone-${i}`, 'someone', null); // a goodbye from a room we never saw them in
    }
    const after = count();
    assert.ok(after - before < 20, `${after - before} more Sets after 500 rooms were left`);
    net.close();
  } finally {
    globalThis.RTCPeerConnection = real;
  }
});
