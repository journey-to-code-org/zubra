// The Zubra pane in the Elements panel: reads the selected node ($0) through the page's
// `__ZUBRA_DEVTOOLS__` (runtime/src/devtools.js) and shows it. Only `inspectedWindow.eval`: no
// content script, no host permissions. It re-reads when the selection changes, and when the
// page's update counter moves while the pane is visible.
import { announcement, render } from './render.js';

const pane = document.getElementById('pane');
// What a screen reader hears: a short line when something meaningful changed (the pane itself
// isn't a live region, so it isn't read out again on every update).
let status = document.getElementById('pane-status');
if (!status) {
  status = Object.assign(document.createElement('p'), { id: 'pane-status', className: 'visually-hidden' });
  status.setAttribute('role', 'status');
  pane.after(status);
}
const inspected = chrome.devtools.inspectedWindow;
document.documentElement.dataset.theme = chrome.devtools.panels.themeName === 'dark' ? 'dark' : 'light';

// Runs in the page. The hook is the one in the selected node's own window, so a component inside
// a same-origin frame (the playground's previews) is read from that frame.
const HOOK = '(($0 && $0.ownerDocument && $0.ownerDocument.defaultView) || globalThis).__ZUBRA_DEVTOOLS__';
// Connect (which loads the reading side once), then inspect the selection.
const READ = `(() => {
  const hook = ${HOOK};
  if (!hook) return { missing: true };
  hook.connect();
  if (!hook.ready) return { loading: true };
  return hook.inspect($0);
})()`;
const UPDATES = `${HOOK}?.updates ?? null`;

const evaluate = (code) => new Promise((resolve) => {
  inspected.eval(code, (result, exception) => resolve(exception ? { error: exception.value ?? exception.description ?? 'the page threw' } : result));
});

/** Put the rendered HTML in the pane. render() escapes every value from the page; parsing it
 * with DOMParser (no scripts run there) rather than assigning innerHTML keeps that plain.
 * A new selection replaces the content; an update patches it, so the element with focus and
 * the sections opened or closed stay as they were. Focus that was on an "open in editor"
 * button goes back to the button for the same place if its element was replaced. */
function show(html, fresh) {
  const parsed = new DOMParser().parseFromString(html, 'text/html').body;
  const focused = pane.contains(document.activeElement) ? document.activeElement : null;
  const place = focused?.matches('button[data-file]') ? [focused.dataset.file, focused.dataset.line, focused.dataset.column] : null;
  if (fresh) pane.replaceChildren(...parsed.childNodes);
  else patch(pane, parsed);
  if (focused && !focused.isConnected && place) {
    [...pane.querySelectorAll('button[data-file]')].find((button) => button.dataset.file === place[0] && button.dataset.line === place[1] && button.dataset.column === place[2])?.focus();
  }
}

/** Make `into`'s children match `from`'s, keeping the nodes that are the same kind in the same
 * place (text and attributes are copied over; nothing is parsed as HTML). A <details> keeps
 * whether it's open, which is the reader's choice. */
function patch(into, from) {
  const wanted = [...from.childNodes];
  wanted.forEach((want, index) => {
    const have = into.childNodes[index];
    if (!have) return into.append(want);
    if (have.nodeType !== want.nodeType || have.nodeName !== want.nodeName) return have.replaceWith(want);
    if (have.nodeType !== Node.ELEMENT_NODE) {
      if (have.nodeValue !== want.nodeValue) have.nodeValue = want.nodeValue;
      return;
    }
    const keep = (name) => name === 'open' && have.localName === 'details';
    for (const { name } of [...have.attributes]) if (!want.hasAttribute(name) && !keep(name)) have.removeAttribute(name);
    for (const { name, value } of want.attributes) if (!keep(name) && have.getAttribute(name) !== value) have.setAttribute(name, value);
    patch(have, want);
  });
  while (into.childNodes.length > wanted.length) into.lastChild.remove();
}

/** Say `text` in the status line, at most once every two seconds (the latest wins), except
 * a new selection, which is said at once. */
let said = 0;
let waiting = null;
function announce(text, now = false) {
  if (!text) return;
  clearTimeout(waiting);
  const wait = now ? 0 : Math.max(0, said + 2000 - Date.now());
  waiting = setTimeout(() => {
    said = Date.now();
    status.textContent = text;
  }, wait);
}

let lastUpdates = null;
let last = null;
let reading = false;
async function read(attempt = 0, selected = false) {
  if (reading) return;
  reading = true;
  const result = await evaluate(READ);
  reading = false;
  const fresh = selected || !last || last.loading || last.component?.tag !== result?.component?.tag || last.component?.file !== result?.component?.file;
  show(render(result), fresh);
  announce(announcement(last, result, selected), selected);
  if (!result?.loading) last = result;
  lastUpdates = result?.update ?? null;
  // The reading side is loading (a dynamic import): try again shortly.
  if (result?.loading && attempt < 40) setTimeout(() => read(attempt + 1, selected), 50);
}

pane.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-file]');
  if (!button) return;
  const { file, line, column } = button.dataset;
  evaluate(`${HOOK}?.open(${JSON.stringify(file)}, ${Number(line)}, ${Number(column)})`);
});

chrome.devtools.panels.elements.onSelectionChanged.addListener(() => read(0, true));
// A navigation in the inspected page: start over.
chrome.devtools.network?.onNavigated?.addListener(() => setTimeout(() => read(0, true), 300));

// Follow updates while visible: one cheap counter read, a full read only when it moved.
setInterval(async () => {
  if (document.visibilityState !== 'visible') return;
  const updates = await evaluate(UPDATES);
  if (updates !== null && updates !== lastUpdates) read();
}, 500);

read();
