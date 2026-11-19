import 'server-only';
import { cookies } from 'next/headers';
import { createSlice } from 'counter-slice-backend';

/** One slice per server process, however many bundles import this. */
export const getSlice = () => (globalThis.__counterSlice ??= createSlice());

/** The guest this request belongs to. Only an action may set the cookie, for a newcomer. */
export async function currentGuest({ remember = false } = {}) {
  const slice = await getSlice();
  const jar = await cookies();
  const { guest, setCookie } = slice.guest(jar.toString());
  if (remember && setCookie) {
    const [pair, ...attributes] = setCookie.split('; ');
    const [name, value] = pair.split('=');
    const maxAge = Number(attributes.find((one) => one.startsWith('Max-Age='))?.slice(8));
    jar.set(name, decodeURIComponent(value), { path: '/', httpOnly: true, sameSite: 'lax', maxAge, secure: attributes.includes('Secure') });
  }
  return { slice, guest };
}

/** The signed message in the page's address, from Next's searchParams. */
export const said = (slice, searchParams) => slice.said(new URL(`http://slice/?${new URLSearchParams(searchParams)}`));
