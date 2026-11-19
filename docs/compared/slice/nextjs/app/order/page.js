import { currentGuest, said } from '../../lib/slice.js';
import { Notice } from '../notice.js';
import { change, choose } from '../actions.js';

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

export async function generateMetadata() {
  const { slice } = await currentGuest();
  return { title: `Your order · ${slice.shop.name}` };
}

function Qty({ line, to, children }) {
  return (
    <form action={change}>
      <input type="hidden" name="item" value={line.item} />
      <button name="qty" value={to}>{children}</button>
    </form>
  );
}

export default async function OrderPage({ searchParams }) {
  const { slice, guest } = await currentGuest();
  const cart = slice.cart(guest);
  const times = slice.times();
  const chosen = slice.pickup(guest);
  const time = times.find((one) => one.slot === chosen);
  return (
    <>
      <Notice said={said(slice, await searchParams)} />
      <h1>Your order</h1>
      <section className="panel">
        <h2>In your bag</h2>
        {cart.lines.length ? (
          <>
            <ul className="lines">
              {cart.lines.map((line) => (
                <li key={line.item} className="line">
                  <div>
                    <h3>{line.name}</h3>
                    <p className="meta">{money(line.cents)} each · {money(line.total)}</p>
                  </div>
                  <div className="qty">
                    <Qty line={line} to={line.qty - 1}>−</Qty>
                    <span>{line.qty}</span>
                    <Qty line={line} to={line.qty + 1}>+</Qty>
                    <Qty line={line} to={0}>Remove</Qty>
                  </div>
                </li>
              ))}
            </ul>
            <p className="total">Total {money(cart.cents)}</p>
          </>
        ) : (
          <p>Your bag is empty.</p>
        )}
      </section>
      <section className="panel">
        <h2>Pickup time</h2>
        <form action={choose}>
          <label htmlFor="slot">When you’ll come by</label>
          <select id="slot" name="slot" defaultValue={chosen}>
            <option value="">Choose…</option>
            {times.map((one) => (
              <option key={one.slot} value={one.slot} disabled={one.full}>
                {one.day} {one.label}{one.full ? ' (full)' : ''}
              </option>
            ))}
          </select>
          <button>Set the time</button>
        </form>
        {time && <p>Pickup: {time.day} at {time.label}</p>}
      </section>
      {cart.lines.length > 0 && time && <a className="button" href="/checkout">Check out</a>}
    </>
  );
}
