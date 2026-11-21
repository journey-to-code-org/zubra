// The whole server: it renders the page with its components already in the HTML, serves their
// browser modules, and runs the form's server function. No bundler and no build step.
//
//   npm run dev     development (`--dev`): restarts when this file or anything in src/ changes, an
//                   edited component is swapped into the open page, keeping its state, any other
//                   change reloads it, and an error's page says what went wrong
//   npm start       the same server in production, the default (errors say only that something
//                   went wrong)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createZubra } from '@zubra/server';
import { createActions } from '@zubra/actions';
import { notes } from './src/notes.js';

// Production unless told otherwise: `npm run dev` passes --dev, which is NODE_ENV=development for
// @zubra/server and @zubra/actions (on any OS: nothing to set in the shell).
if (process.argv.includes('--dev')) process.env.NODE_ENV = 'development';
const production = process.env.NODE_ENV !== 'development';
const components = 'src/components';

// `cache` keeps what was compiled; in development an edit to a .zb file is still in the next
// page (the folder's files are checked for changes first), without compiling every component
// on every request.
// `compress` sends the modules, and with a recent @zubra/server the page too, in Brotli or gzip;
// take it out (here, and in createActions) if your host or a proxy in front compresses already.
// `reload`: in development, when this server is back from a restart, the components that changed
// are swapped into the open page (keeping their state), and any other change reloads it.
const zubra = createZubra({ components, cache: true, compress: true, reload: !production });
const sendsPages = typeof zubra.send === 'function';
if (!sendsPages) console.warn('This @zubra/server does not compress pages. Upgrade it to a release with zubra.send, or compress pages at your proxy.');
// The functions marked 'use server' in the components, served at /_zb/action/<tag>/<name>.
const actions = await createActions({ components, compress: true });

const styles = readFileSync(new URL('./src/style.css', import.meta.url), 'utf8');

export const server = createServer(async (req, res) => {
  try {
    // 1. A form posted to a server function (with or without JavaScript in the browser).
    if (await actions.handle(req, res)) return;
    // 2. The components' browser modules and the runtime, under /_zubra/.
    if (zubra.handle(req, res)) return;
    if (new URL(req.url, 'http://x').pathname !== '/') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    // 3. The page. Without JavaScript the form posts, the server redirects back here, and
    //    `actions.result()` has what the function returned, once.
    const sent = actions.result(req, (name, value) => res.setHeader(name, value));
    // (Rendered before the status is sent: a component that doesn't compile is a 500, not a 200.)
    const html = home(sent?.value);
    if (sendsPages) zubra.send(req, res, html);
    else res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  } catch (error) {
    console.error(error);
    // In development the page says what the terminal says (a component's error comes with its
    // file, line and often a fix) and goes away when the fix is saved; in production it says
    // only that something went wrong.
    const failed = zubra.errorPage(error);
    if (!res.headersSent) res.writeHead(failed.status, { 'content-type': failed.type });
    res.end(failed.body);
  }
});

/** The home page. One `zubra.page()` per request: it renders, and it finishes. */
function home(sent) {
  const page = zubra.page();
  const body = `
    <main>
      ${page.render('zubra-welcome', { heading: '{{title}}', framework: 'a Node server' })}
      <section class="try">
        ${page.render('hello-counter', { label: 'Clicks', count: 2 })}
        <p>Rendered on the server at 2, and counting in the browser from there.</p>
      </section>
      <section class="try">
        ${page.render('guest-book', { saved: notes, said: sent?.error ?? '' })}
      </section>
      ${page.render('zubra-examples')}
    </main>`;
  // finish() adds the CSS and modules of exactly the components this page rendered.
  return page.finish(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link rel="icon" href="data:,">
    <title>{{title}}</title>
    <style>${styles}</style>
  </head>
  <body>${body}
    ${actions.script()}
  </body>
</html>`);
}

// (The test imports `server` and listens on a port of its own.)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => console.log(`{{title}}: http://localhost:${port}`));
}
