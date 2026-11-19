// One thing on the menu, as an Enhance element: a pure function of its attributes. The server
// expands it into plain HTML; in the browser the same render runs again whenever `left` changes.
const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default {
  attrs: ['left'],
  render({ html, state }) {
    const { item, name, unit, cents, left = '', add } = state.attrs;
    const out = left !== '' && Number(left) <= 0;
    const words = left === '' ? '' : out ? 'Sold out' : `${left} left`;
    const off = out ? ' disabled' : '';
    return html`<h3${out ? ' class="out"' : ''}>${escape(name)}</h3>
<p class="meta">${money(cents)} · ${escape(unit)}${words ? ` · <span class="left">${words}</span>` : ''}</p>
<form method="post" action="${escape(add)}">
  <input type="hidden" name="item" value="${escape(item)}">
  <input type="number" name="qty" value="1" min="1" max="24" aria-label="How many ${escape(name)}"${off}>
  <button type="submit"${off}>Add</button>
</form>`;
  },
};
