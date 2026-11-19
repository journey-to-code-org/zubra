// One thing on the menu, as a Lit element. The server renders it with declarative shadow DOM;
// in the browser it hydrates, and the page sets `left` whenever the live feed says.
import { LitElement, html } from 'lit';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export class SliceItem extends LitElement {
  static properties = { item: {}, name: {}, unit: {}, cents: { type: Number }, left: { type: Number }, add: {} };

  render() {
    const out = this.left != null && this.left <= 0;
    const words = this.left == null ? '' : out ? 'Sold out' : `${this.left} left`;
    return html`<link rel="stylesheet" href="/slice.css">
      <h3 class=${out ? 'out' : ''}>${this.name}</h3>
      <p class="meta">${money(this.cents)} · ${this.unit}${words ? html` · <span class="left">${words}</span>` : ''}</p>
      <form method="post" action=${this.add}>
        <input type="hidden" name="item" .value=${this.item}>
        <input type="number" name="qty" value="1" min="1" max="24" aria-label="How many ${this.name}" ?disabled=${out}>
        <button type="submit" ?disabled=${out}>Add</button>
      </form>`;
  }
}
customElements.define('slice-item', SliceItem);
