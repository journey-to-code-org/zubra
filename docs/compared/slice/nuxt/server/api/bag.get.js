export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event);
  return { shop: slice.shop.name, cart: slice.cart(guest), times: slice.times(), chosen: slice.pickup(guest) };
});
