import { error } from '@sveltejs/kit';
import { currentGuest } from '#lib/server/slice.js';

export async function load({ cookies, params }) {
  const { slice, guest } = await currentGuest(cookies);
  const order = slice.order(guest, params.key);
  if (!order) error(404, 'We can’t find that order.');
  return { order };
}
