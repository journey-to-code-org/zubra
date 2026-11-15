# @zubra/router

Serve Zubra components as pages, for apps with no host framework. A component says where it lives with `'use route <path>'`; an exported `load` runs on the server before it renders, and what it returns becomes its props.

```html
<script>
  'use route /farms/:id'
  import { farms } from '../db.js'
  export async function load({ params }) {
    const farm = await farms.get(params.id)
    return { name: farm.name }
  }
</script>
<farm-page name="">
  <h1>{name}</h1>
</farm-page>
```

```js
import { createServer } from 'node:http';
import { createZubra } from '@zubra/server';
import { createRouter } from '@zubra/router';

const zubra = createZubra({ components: 'components' });
const router = await createRouter({ zubra, components: 'components' });

createServer(async (req, res) => {
  if (zubra.handle(req, res)) return;         // the components' browser modules
  if (await router.handle(req, res)) return;  // a GET or HEAD to a route
  res.writeHead(404).end('Not found');        // the app's own routes, files, 404
}).listen(3000);
```

`router.listener` is that handler with a plain 404, and `router.fetch(request)` answers fetch-style servers (a `Response`, or `null` when the path isn't a route).

## Routes

- `'use route /farms/:id'` names a path in [URLPattern](https://developer.mozilla.org/docs/Web/API/URL_Pattern_API) syntax: `:id`, `:path*`, `:tab?`.
- In a `routes/` folder inside the components folder, a bare `'use route'` takes its path from its place: `routes/index.zb` is `/`, `routes/farms/[id].zb` is `/farms/:id`, `routes/docs/[...path].zb` is `/docs/:path*`. A written path there must agree with the folder.
- A path with text in a segment is tried before one with a parameter there, and a parameter before a wildcard.
- Two routes with one path, and a parameter that neither `load` nor a prop reads, are errors: the compiler reports a written path's, `createRouter` a folder's and the duplicates.
- With `@zubra/router` not installed, `@zubra/server` refuses to render a `'use route'` component and says what to install.

## `load`

`load({ params, url, request })` runs on the server only. The compiler takes it, and whatever only it imports, out of the browser module; it isn't an action, so nothing can post to it. The props the page declares are taken from its result (anything else stays on the server), and a parameter the page declares as a prop is passed too. A `load` that throws gets a plain 500, and `onError(error, request)` is told.

## Not yet

This is stage A2 of `plan/roadmap-app.md`: layouts and `app.zb` (A3), `load`'s other answers (not found, redirect, a title, the app's `context`, an action's result: A4) and errors inside the layout (A6) come next. Pages are whole page loads; there is no client-side navigation.
