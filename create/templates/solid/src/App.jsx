import { createSignal } from 'solid-js';
// Solid uses the element directly: prop:name sets a property, on:name listens.
import './components/hello-counter.zb';
import './components/zubra-welcome.zb';
import './components/zubra-examples.zb';

export default function App() {
  const [count, setCount] = createSignal(0);
  return (
    <main>
      <zubra-welcome heading="{{title}}" framework="Solid" />
      <section class="try">
        <hello-counter prop:count={count()} on:countchange={(event) => setCount(event.detail)} label="Clicks" />
        <p>Solid sees <span id="seen">{count()}</span></p>
      </section>
      <zubra-examples />
    </main>
  );
}
