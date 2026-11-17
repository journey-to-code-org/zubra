/**
 * Plain form posts without the reload (experimental). Importing this module starts it for the
 * document. A form that names the parts of the page its post changes, by id,
 * `<form method="post" action="/add" data-zb-updates="site said">`, is sent with `fetch`, and
 * those parts' children are taken from the page the server redirects back to. Every other form,
 * and every case this can't handle, posts as the browser does.
 *
 * The form gets an `updated` event (bubbles; `detail.url` is where the server sent the page).
 *
 * @param root Where to listen: the document by default; pass a shadow root for forms inside one.
 * @returns A function that stops listening.
 */
export function enhanceForms(root?: Document | ShadowRoot | Element): () => void;
