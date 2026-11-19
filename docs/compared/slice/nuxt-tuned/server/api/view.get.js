/**
 * Everything one page needs, in one call: the header's count, the signed message, and the page's own
 * data. Tuned from the default build, where each page made three calls (bag, menu, message).
 */
export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event);
  const { path = '/', ...query } = getQuery(event);
  const common = { shop: slice.shop.name, count: slice.cart(guest).count, said: slice.said(new URL(`http://slice/?${new URLSearchParams(query)}`)) };
  if (path === '/') return { ...common, sections: slice.menu() };
  const cart = slice.cart(guest);
  const times = slice.times();
  const chosen = slice.pickup(guest);
  if (path === '/order') return { ...common, cart, times, chosen };
  if (path === '/checkout') {
    if (!cart.lines.length) return { ...common, back: slice.back('/order', { problem: 'Your bag is empty.' }) };
    if (!chosen) return { ...common, back: slice.back('/order', { problem: 'Choose a pickup time first.' }) };
    return { ...common, cart, time: times.find((one) => one.slot === chosen), checkout: slice.checkoutKey() };
  }
  const ordered = /^\/orders\/([a-z0-9]+)$/.exec(String(path));
  return { ...common, order: ordered ? slice.order(guest, ordered[1]) : null };
});
