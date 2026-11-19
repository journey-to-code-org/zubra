export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event);
  const cart = slice.cart(guest);
  const time = slice.times().find((one) => one.slot === slice.pickup(guest));
  if (!cart.lines.length) return { back: slice.back('/order', { problem: 'Your bag is empty.' }) };
  if (!time) return { back: slice.back('/order', { problem: 'Choose a pickup time first.' }) };
  return { shop: slice.shop.name, cart, time, checkout: slice.checkoutKey() };
});
