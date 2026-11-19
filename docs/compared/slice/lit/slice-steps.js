// Where an order is, as a Lit element. The server renders it; the page sets `status` from the feed.
import { LitElement, html } from 'lit';

const STEPS = [['placed', 'Placed'], ['making', 'Being made'], ['ready', 'Ready at the window'], ['picked-up', 'Picked up']];

export class SliceSteps extends LitElement {
  static properties = { status: {} };

  render() {
    const reached = STEPS.findIndex(([step]) => step === this.status);
    return html`<link rel="stylesheet" href="/slice.css">
      <ol class="steps" aria-label="Where your order is">${STEPS.map(([, words], i) => html`<li class=${i <= reached ? 'done' : ''}>${words}</li>`)}</ol>`;
  }
}
customElements.define('slice-steps', SliceSteps);
