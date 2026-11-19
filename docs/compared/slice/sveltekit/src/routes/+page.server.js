import { redirect } from '@sveltejs/kit';
import { currentGuest } from '#lib/server/slice.js';

export async function load({ cookies, url }) {
  const { slice } = await currentGuest(cookies);
  return { sections: slice.menu(), said: slice.said(url) };
}

export const actions = {
  async add({ cookies, request }) {
    const { slice, guest } = await currentGuest(cookies, { remember: true });
    const form = await request.formData();
    const done = await slice.add(guest, { item: form.get('item'), qty: form.get('qty') });
    redirect(303, slice.back('/', done.ok ? { done: 'Added to your order.' } : { problem: done.error }));
  },
};
