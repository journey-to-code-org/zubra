export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event, { remember: true });
  const form = await readFormData(event);
  const done = await slice.add(guest, { item: form.get('item'), qty: form.get('qty') });
  return sendRedirect(event, slice.back('/', done.ok ? { done: 'Added to your order.' } : { problem: done.error }), 303);
});
