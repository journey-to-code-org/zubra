export default defineEventHandler(async (event) => {
  const { slice, guest } = await currentGuest(event, { remember: true });
  const form = await readFormData(event);
  const done = await slice.place(guest, { checkout: form.get('checkout'), name: form.get('name'), email: form.get('email'), card: form.get('card') });
  return sendRedirect(event, done.ok ? `/orders/${done.key}` : slice.back(done.back ?? '/checkout', { problem: done.error }), 303);
});
