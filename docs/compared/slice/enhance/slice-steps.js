// Where an order is, as an Enhance element: a pure function of its `status`. The server expands it;
// in the browser the same render runs again when the page sets `status` from the feed.
const STEPS = [['placed', 'Placed'], ['making', 'Being made'], ['ready', 'Ready at the window'], ['picked-up', 'Picked up']];

export default {
  attrs: ['status'],
  render({ html, state }) {
    const reached = STEPS.findIndex(([step]) => step === state.attrs.status);
    return html`<ol class="steps" aria-label="Where your order is">${STEPS.map(([, words], i) => `<li${i <= reached ? ' class="done"' : ''}>${words}</li>`).join('')}</ol>`;
  },
};
