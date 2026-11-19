import { createSlice } from 'counter-slice-backend';

/** One slice per server process. */
export const getSlice = () => (globalThis.__counterSlice ??= createSlice());

/** The guest this request belongs to. Only a post sets the cookie, for a newcomer. */
export async function currentGuest(event, { remember = false } = {}) {
  const slice = await getSlice();
  const { guest, setCookie } = slice.guest(getRequestHeader(event, 'cookie') ?? '');
  if (remember && setCookie) appendResponseHeader(event, 'set-cookie', setCookie);
  return { slice, guest };
}
