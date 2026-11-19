import { redirect } from '@sveltejs/kit';
import { currentGuest } from '#lib/server/slice.js';

export async function load({ cookies, url }) {
  const { slice, guest } = await currentGuest(cookies);
  const cart = slice.cart(guest);
  const time = slice.times().find((one) => one.slot === slice.pickup(guest));
  if (!cart.lines.length) redirect(303, slice.back('/order', { problem: 'Your bag is empty.' }));
  if (!time) redirect(303, slice.back('/order', { problem: 'Choose a pickup time first.' }));
  return { cart, time, checkout: slice.checkoutKey(), said: slice.said(url) };
}

export const actions = {
  async default({ cookies, request }) {
    const { slice, guest } = await currentGuest(cookies, { remember: true });
    const form = await request.formData();
    const done = await slice.place(guest, { checkout: form.get('checkout'), name: form.get('name'), email: form.get('email'), card: form.get('card') });
    redirect(303, done.ok ? `/orders/${done.key}` : slice.back(done.back ?? '/checkout', { problem: done.error }));
  },
};
