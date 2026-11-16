# 7. Server rendering

Every component also compiles to HTML: the same markup the element would render, so the page shows content before any JavaScript runs. When the script loads, the element checks that the markup has its template's shape and **binds to it in place**. Nothing is re-rendered, and a part writes to the DOM only when its value differs.

## In a framework

- **Astro**: add `@zubra/unplugin/astro` to the integrations (`npm create zubra -- --framework astro` does). Components render on the server, and a client directive (`client:load`, `client:visible`, …) hydrates one in the browser.
- **SvelteKit, Nuxt, React Router, SolidStart**: the framework renders the element's tag, and `@zubra/server` adds its content to the page. Under Nuxt and React Router, the Vue and React wrappers render a light-DOM element's content themselves. Use `shadow` components under SvelteKit, and for any element given React or Vue children. Under SolidStart, pass `{ lightDom: true }` to `injectShadowRoots` to fill light-DOM elements too.

  ```js
  // SvelteKit: src/hooks.server.js
  import { createZubra } from '@zubra/server';
  const Zubra = createZubra({ components: 'src/components' });
  export const handle = ({ event, resolve }) => resolve(event, { transformPageChunk: ({ html }) => Zubra.injectShadowRoots(html) });
  ```

  The page is complete before JavaScript, and form controls submit their server-rendered values (`examples/meta/` has each framework).
- **Next.js**: import `.zb` files through the Turbopack loader, with its server rule (`options: { server: true }`, see the README). The React wrapper then writes each shadow-DOM element's shadow root into the server's HTML, for elements without React children.

## In your own server

`@zubra/server` works with any template engine (Express, Fastify and Hono have adapters):

```js
import { createZubra } from '@zubra/server';
const zubra = createZubra({ components: 'src/components' });

// per request
if (zubra.handle(req, res)) return;               // the browser modules and @zubra/runtime
const page = zubra.page();
const card = page.render('info-card', { heading: 'Plans' }); // HTML, inside your template
res.end(page.finish(myLayout(card)));            // + the components' CSS and module scripts
```

Two things to get right from the start:

- **One `zubra.page()` per request, used for both `render()` and `finish()`.** The page object collects the components it renders, and `finish()` adds the CSS and modules of those. A page rendered by one object and finished by another shows the server's HTML and never comes alive.
- **Edit and reload.** In development an edit to a `.zb` file (or a file added or removed) shows on the next request; there's nothing to restart. The server keeps what it compiled and lets go of it when something in the components folder changes. With `NODE_ENV=production` it compiles once and never looks again, which is what a deployed server wants. A file a component imports from outside the folder isn't watched: restart for those.

To change a rendered component from a script on the page (a live price, a status), set its props as properties: [Setting a prop from outside](03-props-and-events.md#setting-a-prop-from-outside).

The component's script runs on the server too, as far as it's deterministic: `.map()`, `.filter()`, `toFixed()`, `Math`, template literals, and arrow functions from the script. What only the browser can compute (a handler, `Date`, `Intl`, a value from `fetch`) is left for the element: its text renders empty and its region renders when the element starts, without a hydration warning. `zubra check --server` lists those places.

## From the command line

```sh
zubra compile src/components/user-card.zb --props props.json --partial > card.html
```

**Next:** [Read the output](08-read-the-output.md), which shows what all of this compiles to and why. The [README](../../README.md) has every feature in detail, and the [playground](https://journey-to-code-org.github.io/zubra/playground/) is the quickest way to try one.
