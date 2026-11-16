import { useState } from 'preact/hooks';
// Preact uses the element directly: props are set as properties, on<name> listens.
import './components/hello-counter.zb';
import './components/zubra-welcome.zb';
import './components/zubra-examples.zb';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <zubra-welcome heading="{{title}}" framework="Preact" />
      <section class="try">
        <hello-counter count={count} oncountchange={(event) => setCount(event.detail)} label="Clicks" />
        <p>Preact sees <span id="seen">{count}</span></p>
      </section>
      <zubra-examples />
    </main>
  );
}
