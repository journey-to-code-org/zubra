/** The signed message in a page's address: the page passes its query, the server checks it. */
export default defineEventHandler(async (event) => {
  const { slice } = await currentGuest(event);
  return slice.said(new URL(`http://slice/?${new URLSearchParams(getQuery(event))}`));
});
