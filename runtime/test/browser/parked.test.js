// A light-DOM component without slots: what a framework adds to its host is the page's, isn't
// shown, and is still where the framework looks for it (`firstChild`, `parentNode`). Components
// with slots place it instead (slots.test.js). `npm run test:browser`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { useBrowser, open, here, reported, emitElement } from './harness.js';

useBrowser({ counter: join(here, 'fixtures/counter.zb') });

test("a host without slots keeps a framework's children out of its markup, where the framework finds them", { skip: emitElement && "--emit element output has no runtime to route a host's children" }, async () => {
  const { page, messages } = await open('<zb-counter></zb-counter>', { modules: ['counter'] });
  const result = await page.evaluate(async () => {
    const host = document.querySelector('zb-counter');
    await host.updateComplete;
    const markup = () => [...Element.prototype.querySelectorAll.call(host, '*')].map((node) => node.localName).join(' ');
    const rendered = markup();
    const seen = [];
    const look = (what) => seen.push([what, host.firstChild?.nodeName ?? null, markup() === rendered]);

    const p = document.createElement('p');
    const span = document.createElement('span');
    host.appendChild(p); look('appendChild');
    host.insertBefore(span, p); look('insertBefore');
    const parked = p.parentNode !== host && span.nextSibling === p && !p.isConnected;
    p.parentNode.removeChild(p); look('removed through its parent (Vue)');
    host.removeChild(span); look('removeChild');
    let threw = false;
    try { host.removeChild(document.createElement('i')); } catch { threw = true; }
    host.textContent = 'words'; look('textContent');
    const text = host.firstChild?.data;
    host.innerHTML = '<em>a</em><strong>b</strong>'; look('innerHTML');
    host.append('x', document.createElement('u')); look('append');
    host.replaceChildren(); look('replaceChildren');
    // The element still works, and its own markup is still what reading it shows.
    host.querySelector('button').click();
    await host.updateComplete;
    return { seen, parked, threw, text, button: host.querySelector('button').textContent, html: host.innerHTML.includes('<button') };
  });
  assert.deepEqual(result.seen, [
    ['appendChild', 'P', true],
    ['insertBefore', 'SPAN', true],
    ['removed through its parent (Vue)', 'SPAN', true],
    ['removeChild', null, true],
    ['textContent', '#text', true],
    ['innerHTML', 'EM', true],
    ['append', 'EM', true],
    ['replaceChildren', null, true],
  ]);
  assert.equal(result.parked, true, 'out of the document, in order');
  assert.equal(result.threw, true, 'removing a node that was never added throws, as natively');
  assert.equal(result.text, 'words');
  assert.equal(result.button, 'Clicks: 1');
  assert.equal(result.html, true, "reading innerHTML shows the element's own markup");
  // In development each addition with content says it isn't shown; production is quiet.
  const notShown = (message) => message.includes('<zb-counter> has no slot named "default"; that content is not shown');
  assert.ok(reported(messages, notShown), messages.join('\n'));
  assert.deepEqual(messages.filter((message) => !notShown(message)), []);
});
