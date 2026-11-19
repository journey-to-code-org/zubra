import { redirect } from '@sveltejs/kit';
import { currentGuest } from '#lib/server/slice.js';

export async function load({ cookies, url }) {
  const { slice, guest } = await currentGuest(cookies);
  return { cart: slice.cart(guest), times: slice.times(), chosen: slice.pickup(guest), said: slice.said(url) };
}

export const actions = {
  async change({ cookies, request }) {
    const { slice, guest } = await currentGuest(cookies, { remember: true });
    const form = await request.formData();
    const done = await slice.change(guest, { item: form.get('item'), qty: form.get('qty') });
    redirect(303, slice.back('/order', done.ok ? {} : { problem: done.error }));
  },
  async choose({ cookies, request }) {
    const { slice, guest } = await currentGuest(cookies, { remember: true });
    const done = await slice.choose(guest, (await request.formData()).get('slot'));
    redirect(303, slice.back('/order', done.ok ? {} : { problem: done.error }));
  },
};
