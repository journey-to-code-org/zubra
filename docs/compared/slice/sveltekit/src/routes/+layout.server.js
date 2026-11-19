import { currentGuest } from '#lib/server/slice.js';

export async function load({ cookies }) {
  const { slice, guest } = await currentGuest(cookies);
  return { shop: slice.shop.name, count: slice.cart(guest).count };
}
