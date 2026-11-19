/** What's left on the menu, pushed as server-sent events whenever it changes. */
export default defineEventHandler(async (event) => {
  const slice = await getSlice();
  const rows = (menu) => JSON.stringify(menu.flatMap(({ items }) => items.map((item) => [item.key, item.left])));
  const stream = createEventStream(event);
  const unsubscribe = slice.subscribe((menu) => stream.push(rows(menu)));
  stream.onClosed(async () => {
    unsubscribe();
    await stream.close();
  });
  stream.push(rows(slice.menu()));
  return stream.send();
});
