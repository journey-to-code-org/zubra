'use client';
import { useEffect, useState } from 'react';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const words = (left) => (left == null ? '' : left > 0 ? `${left} left` : 'Sold out');

/** The menu, kept live: the server pushes what's left, and each row follows it. */
export function LiveMenu({ sections, add }) {
  const [left, setLeft] = useState(() => Object.fromEntries(sections.flatMap(({ items }) => items.map((item) => [item.key, item.left]))));
  useEffect(() => {
    const live = new EventSource('/live');
    live.onmessage = (event) => setLeft(Object.fromEntries(JSON.parse(event.data)));
    return () => live.close();
  }, []);
  return sections.map(({ section, items }) => (
    <section key={section}>
      <h2>{section}</h2>
      <ul className="items">
        {items.map((item) => {
          const now = left[item.key];
          const out = now != null && now <= 0;
          return (
            <li key={item.key} className={out ? 'item out' : 'item'}>
              <h3>{item.name}</h3>
              <p className="meta">
                {money(item.cents)} · {item.unit}
                {words(now) && <> · <span className="left">{words(now)}</span></>}
              </p>
              <form action={add}>
                <input type="hidden" name="item" value={item.key} />
                <input type="number" name="qty" defaultValue="1" min="1" max="24" aria-label={`How many ${item.name}`} disabled={out} />
                <button type="submit" disabled={out}>Add</button>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  ));
}
