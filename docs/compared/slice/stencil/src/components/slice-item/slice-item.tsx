import { Component, Prop, h } from '@stencil/core';

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** One thing on the menu. Rendered on the server, hydrated in the browser; the page sets `left`. */
@Component({ tag: 'slice-item', shadow: false })
export class SliceItem {
  @Prop() item: string;
  @Prop() name: string;
  @Prop() unit: string;
  @Prop() cents: number;
  @Prop({ mutable: true, reflect: true }) left?: number | null;
  @Prop() add: string;

  render() {
    const out = this.left != null && this.left <= 0;
    const words = this.left == null ? '' : out ? 'Sold out' : `${this.left} left`;
    return [
      <h3 class={out ? 'out' : ''}>{this.name}</h3>,
      <p class="meta">
        {money(this.cents)} · {this.unit}
        {words ? [' · ', <span class="left">{words}</span>] : null}
      </p>,
      <form method="post" action={this.add}>
        <input type="hidden" name="item" value={this.item} />
        <input type="number" name="qty" value="1" min="1" max="24" aria-label={`How many ${this.name}`} disabled={out} />
        <button type="submit" disabled={out}>Add</button>
      </form>,
    ];
  }
}
