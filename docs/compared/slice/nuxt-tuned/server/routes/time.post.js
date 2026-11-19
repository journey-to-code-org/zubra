export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event, { remember: true });
  const done = await slice.choose(guest, (await readFormData(event)).get('slot'));
  return sendRedirect(event, slice.back('/order', done.ok ? {} : { problem: done.error }), 303);
});
