export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event, { remember: true });
  const form = await readFormData(event);
  const done = await slice.change(guest, { item: form.get('item'), qty: form.get('qty') });
  return sendRedirect(event, slice.back('/order', done.ok ? {} : { problem: done.error }), 303);
});
