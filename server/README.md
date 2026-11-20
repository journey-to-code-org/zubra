# @zubra/server

[Zubra](https://github.com/zubra-js/zubra) components on a Node server: render them into any template engine's pages, serve their browser modules and the runtime, and give a framework's HTML its components' shadow roots. Adapters for Express, Fastify and Hono, and `@zubra/server/edge` for Workers.

```sh
npm install @zubra/server @zubra/compiler @zubra/runtime
```

Install the three at one version.

## A server

```js
import { createServer } from 'node:http';
import { createZubra } from '@zubra/server';

const zubra = createZubra({ components: 'src/components' });

createServer((req, res) => {
  if (zubra.handle(req, res)) return;                       // the components' modules and @zubra/runtime
  const page = zubra.page();                                // one per request
  const card = page.render('info-card', { heading: 'Plans' });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page.finish(`<!doctype html><title>Plans</title><main>${card}</main>`)); // + their CSS and module scripts
}).listen(3000);
```

The page is complete before JavaScript arrives, and each component hydrates the HTML it was sent. `npm create zubra@latest my-app -- --framework server` writes a working app around this, with a form that runs a function on the server and a browser test.

## More

- [Server rendering](https://github.com/zubra-js/zubra/blob/main/docs/guide/07-server-rendering.md), the tutorial's chapter, and [server rendering, honestly](https://github.com/zubra-js/zubra/blob/main/docs/server-rendering.md): what renders where, and the gaps.
- [Server rendering and hydration](https://github.com/zubra-js/zubra/blob/main/docs/reference.md#server-rendering-and-hydration) in the reference.
- [Stability](https://github.com/zubra-js/zubra/blob/main/docs/stability.md): what 6.x promises for each entry.

## License

ISC. See `LICENSE`.
