import { createSlice } from 'counter-slice-backend';

/** One slice per server process. */
export const getSlice = () => (globalThis.__counterSlice ??= createSlice());

/** The guest this request belongs to. Only an action sets the cookie, for a newcomer. */
export async function currentGuest(cookies, { remember = false } = {}) {
  const slice = await getSlice();
  const header = cookies.getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ');
  const { guest, setCookie } = slice.guest(header);
  if (remember && setCookie) {
    const [pair, ...attributes] = setCookie.split('; ');
    const [name, value] = pair.split('=');
    const maxAge = Number(attributes.find((one) => one.startsWith('Max-Age='))?.slice(8));
    cookies.set(name, decodeURIComponent(value), { path: '/', httpOnly: true, sameSite: 'lax', maxAge, secure: attributes.includes('Secure') });
  }
  return { slice, guest };
}
