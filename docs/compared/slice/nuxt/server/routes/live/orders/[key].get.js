/** This guest's order's status, pushed as server-sent events whenever the kitchen moves it. */
export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event);
  const order = slice.order(guest, getRouterParam(event, 'key'));
  if (!order) throw createError({ statusCode: 404 });
  const stream = createEventStream(event);
  const unsubscribe = slice.watchOrder(order.key, (one) => stream.push(JSON.stringify(one.status)));
  stream.onClosed(async () => {
    unsubscribe();
    await stream.close();
  });
  stream.push(JSON.stringify(order.status));
  return stream.send();
});
