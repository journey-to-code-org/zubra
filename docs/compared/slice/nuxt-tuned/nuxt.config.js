export default defineNuxtConfig({
  compatibilityDate: '2026-11-15',
  app: { head: { htmlAttrs: { lang: 'en' }, link: [{ rel: 'stylesheet', href: '/slice.css' }] } },
  // The shared backend is plain Node code on the kit: load it at run time, don't bundle it.
  nitro: { externals: { external: ['counter-slice-backend'] } },
});
