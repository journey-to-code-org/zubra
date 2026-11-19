export default defineEventHandler(async (event) => {
  const { slice } = await currentGuest(event);
  return { shop: slice.shop.name, sections: slice.menu() };
});
