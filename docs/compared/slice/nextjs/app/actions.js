'use server';
import { redirect } from 'next/navigation';
import { currentGuest } from '../lib/slice.js';

export async function add(form) {
  const { slice, guest } = await currentGuest({ remember: true });
  const done = await slice.add(guest, { item: form.get('item'), qty: form.get('qty') });
  redirect(slice.back('/', done.ok ? { done: 'Added to your order.' } : { problem: done.error }));
}

export async function change(form) {
  const { slice, guest } = await currentGuest({ remember: true });
  const done = await slice.change(guest, { item: form.get('item'), qty: form.get('qty') });
  redirect(slice.back('/order', done.ok ? {} : { problem: done.error }));
}

export async function choose(form) {
  const { slice, guest } = await currentGuest({ remember: true });
  const done = await slice.choose(guest, form.get('slot'));
  redirect(slice.back('/order', done.ok ? {} : { problem: done.error }));
}

export async function place(form) {
  const { slice, guest } = await currentGuest({ remember: true });
  const done = await slice.place(guest, { checkout: form.get('checkout'), name: form.get('name'), email: form.get('email'), card: form.get('card') });
  redirect(done.ok ? `/orders/${done.key}` : slice.back(done.back ?? '/checkout', { problem: done.error }));
}
