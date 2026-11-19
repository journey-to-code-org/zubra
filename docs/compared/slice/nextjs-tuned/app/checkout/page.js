import { redirect } from 'next/navigation';
import { currentGuest, said } from '../../lib/slice.js';
import { Notice } from '../notice.js';
import { place } from '../actions.js';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function generateMetadata() {
  const { slice } = await currentGuest();
  return { title: `Check out · ${slice.shop.name}` };
}

export default async function CheckoutPage({ searchParams }) {
  const { slice, guest } = await currentGuest();
  const cart = slice.cart(guest);
  const times = slice.times();
  const time = times.find((one) => one.slot === slice.pickup(guest));
  if (!cart.lines.length) redirect(slice.back('/order', { problem: 'Your bag is empty.' }));
  if (!time) redirect(slice.back('/order', { problem: 'Choose a pickup time first.' }));
  return (
    <>
      <Notice said={said(slice, await searchParams)} />
      <h1>Check out</h1>
      <p className="summary">{cart.count} item{cart.count === 1 ? '' : 's'} · {money(cart.cents)} · pickup {time.day} at {time.label}</p>
      <form action={place} className="panel">
        <input type="hidden" name="checkout" value={slice.checkoutKey()} />
        <label htmlFor="name">Name</label>
        <input id="name" name="name" autoComplete="name" />
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="email" />
        <label htmlFor="card">Card number</label>
        <input id="card" name="card" inputMode="numeric" autoComplete="cc-number" />
        <button>Place order · {money(cart.cents)}</button>
      </form>
      <p className="meta">Test mode: 4242 4242 4242 4242 pays, 4000 0000 0000 0002 is declined.</p>
    </>
  );
}
