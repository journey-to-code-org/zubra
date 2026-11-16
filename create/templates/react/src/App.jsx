import { useState } from 'react';
// Imported into React, a component is a React component (typed, with onCountChange).
import HelloCounter from './components/hello-counter.zb';
import ZubraWelcome from './components/zubra-welcome.zb';
import ZubraExamples from './components/zubra-examples.zb';

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <ZubraWelcome heading="{{title}}" framework="React" />
      <section className="try">
        <HelloCounter count={count} onCountChange={(event) => setCount(event.detail)} label="Clicks" />
        <p>React sees <span id="seen">{count}</span></p>
      </section>
      <ZubraExamples />
    </main>
  );
}
