import { notFound } from 'next/navigation';
import { currentGuest } from '../../../lib/slice.js';
import { LiveSteps } from './live-steps.js';

export async function generateMetadata() {
  const { slice } = await currentGuest();
  return { title: `Your order · ${slice.shop.name}` };
}

export default async function OrderPage({ params }) {
  const { slice, guest } = await currentGuest();
  const order = slice.order(guest, (await params).key);
  if (!order) notFound();
  return (
    <>
      <h1>Order for {order.when}</h1>
      <p>For {order.name} · {order.total}</p>
      <LiveSteps order={order.key} steps={order.steps} />
      <ul className="lines">
        {order.lines.map((line) => (
          <li key={line.item}>{line.qty} × {line.name}</li>
        ))}
      </ul>
    </>
  );
}
