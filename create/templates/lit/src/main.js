import { LitElement, html, css } from 'lit';
// In a Lit template, .count sets the property and @countchange listens.
import './components/hello-counter.zb';
import './components/zubra-welcome.zb';
import './components/zubra-examples.zb';

class MyApp extends LitElement {
  static properties = { count: { state: true } };
  // This element has a shadow root, so the page's stylesheet stops at it: its layout is here.
  // (The colours are custom properties from src/style.css, which do come through.)
  static styles = css`
    main { display: grid; gap: 2.5rem; justify-items: center; max-width: 60rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
    .try { display: grid; gap: 0.75rem; justify-items: center; text-align: center; }
    .try p { margin: 0; color: var(--muted); }
  `;

  constructor() {
    super();
    this.count = 0;
  }

  render() {
    return html`
      <main>
        <zubra-welcome heading="{{title}}" framework="Lit"></zubra-welcome>
        <section class="try">
          <hello-counter .count=${this.count} @countchange=${(event) => (this.count = event.detail)} label="Clicks"></hello-counter>
          <p>Lit sees <span id="seen">${this.count}</span></p>
        </section>
        <zubra-examples></zubra-examples>
      </main>
    `;
  }
}
customElements.define('my-app', MyApp);
