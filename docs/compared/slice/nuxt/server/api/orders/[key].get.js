export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event);
  const order = slice.order(guest, getRouterParam(event, 'key'));
  if (!order) throw createError({ statusCode: 404, statusMessage: 'We can’t find that order.' });
  return { shop: slice.shop.name, order };
});
