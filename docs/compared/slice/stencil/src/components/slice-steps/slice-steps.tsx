import { Component, Prop, h } from '@stencil/core';

const STEPS = [['placed', 'Placed'], ['making', 'Being made'], ['ready', 'Ready at the window'], ['picked-up', 'Picked up']];

/** Where an order is. Rendered on the server, hydrated in the browser; the page sets `status`. */
@Component({ tag: 'slice-steps', shadow: false })
export class SliceSteps {
  @Prop({ mutable: true, reflect: true }) status: string;

  render() {
    const reached = STEPS.findIndex(([step]) => step === this.status);
    return (
      <ol class="steps" aria-label="Where your order is">
        {STEPS.map(([, words], i) => (
          <li class={i <= reached ? 'done' : ''}>{words}</li>
        ))}
      </ol>
    );
  }
}
