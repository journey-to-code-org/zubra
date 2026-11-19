'use client';
import { useEffect, useState } from 'react';

/** The order's steps, kept live: the server pushes the order's status, and the steps follow. */
export function LiveSteps({ order, steps }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const live = new EventSource(`/live/orders/${order}`);
    live.onmessage = (event) => setStatus(JSON.parse(event.data));
    return () => live.close();
  }, [order]);
  const reached = status ? steps.findIndex((one) => one.step === status) : steps.findLastIndex((one) => one.done);
  return (
    <ol className="steps" aria-label="Where your order is">
      {steps.map((one, i) => (
        <li key={one.step} className={i <= reached ? 'done' : undefined}>{one.words}</li>
      ))}
    </ol>
  );
}
