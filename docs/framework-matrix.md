# The framework matrix

A framework is "supported" when its row is green on every push. This page says what each row checks, so the claim can be read from outside. The rows are `.github/workflows/ci.yml`'s jobs; the tests are the files named.

## What every row proves

Each framework's app in `examples/frameworks/` (or `examples/meta/` for the server-rendering ones) is a complete app, not a demo of one feature, built and used in Chromium on every push. Across the rows, the things the survey's critique called "a class of very hard to fix edge cases" are the things checked:

| Checked | How |
|---|---|
| Objects and arrays arrive as values | an element given an array or object prop renders from it, and updates when the framework changes it |
| Events reach the idiomatic handler, once | the framework's own listener syntax, asserted to fire with `detail`, with no re-subscription per render (`runtime/test/browser/adapters.test.js`) |
| An inner native event of the same name doesn't leak | `runtime/test/browser/events.test.js` |
| `before…` cancellation | `preventDefault()` in the handler keeps the old value (`adapters.test.js`) |
| Two-way binding without loops | `v-model`, `zubraModel`, the controlled pattern (which is also how Svelte and Solid write it: the prop and its change event), each asserted to update both ways and settle |
| Children and named slots | content from the framework placed, reordered, filtered and removed through the host; fallbacks come back |
| Forms | Zubra controls submit with the framework's form, validate (`:invalid`), reset, and sit in a disabled `<fieldset>` (`runtime/test/browser/forms.test.js`, each app's form) |
| Server rendering and hydration | the server HTML contains the element's markup; hydration logs nothing; the parser's nodes are kept (`examples/meta/*`, each with a no-JavaScript test) |
| Typecheck | a wrong prop type fails `tsc` in React, Vue and plain TypeScript; correct use passes (`plugin/test/plugin.test.js`, `plugin/test/library.test.js`) |
| No leaks | removed elements, including ones React and Vue unmount, are collected (`runtime/test/browser/leaks.test.js`, through the DevTools protocol) |
| Three engines | the runtime's browser suite and the React and Vue apps also run in Firefox and WebKit (the `engines` job) |

## The rows

| Framework | App | Job | What its test walks through |
|---|---|---|---|
| React 19 | `react-board/` (a sprint board) | `frameworks` | `.zb` imports as React components; React-managed children in slots, reordered and filtered; drag and drop; a column from a library built with `zubra build --lib`; a card editor converted with `zubra convert`; undo; a reload that keeps the board |
| React 18 | the runtime's React app, bundled against React 18 | `runtime` | props as properties (read from `zb-props` when the element starts, since React 18 writes attributes), events, children, refs, the controlled pattern |
| Vue 3 | `vue-budget/` (a budget tracker) | `frameworks` | `v-model` on elements, including inside `v-for`, from a library's Vue entry; slot content from a Vue template; a donut chart from Vue's computed state |
| Svelte 5 | `svelte-flashcards/` (a trainer) | `frameworks` | a shadow-DOM element with named slots from Svelte markup; `{#key}` re-creation; an element listening on the document and cleaning up |
| Solid | `solid-markets/` (a live dashboard) | `frameworks` | `prop:`/`on:` updated every tick; nested elements; pointer events |
| Lit 3 | `lit-chat/` (a team chat) | `frameworks` | light-DOM elements inside a LitElement's shadow root with their styles adopted there; context from `@lit/context` read by `inject()` |
| FAST Element 3 | `fast-orders/` (an order sheet) | `frameworks` | light-DOM elements inside a FASTElement's shadow root with their styles adopted there; `:prop` and `@event` bindings in `repeat()`; context from FAST's `Context` read by `inject()` (FAST's provider answers once, so it doesn't update consumers) |
| Preact 11 | `preact-habits/` (a habit tracker) | `frameworks` | objects as props; a custom property from Preact's `style`; keyboard navigation; a form control in a Preact form |
| Angular 22 | `angular-booking/` (a booking wizard) | `frameworks` | reactive forms whose controls are elements (`zubraModel` with `formControlName`), validation, ahead-of-time compilation in Vite |
| Astro | `recipes/` | `plugin` | static components, a JSX island, a form-associated control, loaded reviews |
| Next.js 16 | `next-conference/` | `meta` | the loader; server-rendered light-DOM cards and shadow-DOM controls; Server Actions; no hydration errors |
| Nuxt 4 | `nuxt-bookshop/` | `meta` | `v-model` on server-rendered elements; light-DOM meters and a shadow-DOM switch in the server HTML; the editor's controls through the API |
| SvelteKit 3 | `sveltekit-workouts/` | `meta` | form actions with Zubra controls, with and without JavaScript; `injectShadowRoots` in `hooks.server.js` |
| React Router 8 | `react-router-trips/` | `meta` | loaders, actions and `<Form>`; a light-DOM balance list and shadow-DOM controls in the server HTML; no hydration errors |
| SolidStart 2 | `solidstart-potluck/` | `meta` | `prop:`/`on:` elements as form controls posting to an action; a light-DOM board through `injectShadowRoots(…, { lightDom: true })` |
| Eleventy 3 | `eleventy-trails/` | `meta` | a static site through `@zubra/server`'s `writeAssets`; markers kept through minification with `removeComments: true` |
| Plain HTML | `todo/`, `planner/` | `plugin` | elements used from a page with an import map |
| Express, Hono, Flask, htmx, Electron, a Chrome extension | `helpdesk/`, `hypermedia/`, `backends/`, `desktop/`, `extension/` | `helpdesk`, `hypermedia`, `backends`, `clients` | server rendering from Node and from Python through `zubra serve`; streaming; a strict CSP; another site's page |

## Outside this repository: open.parlor

The rows above are Zubra's own apps. [open.parlor](https://github.com/journey-to-code-org/open.parlor) is a separate app that depends on the published packages, and it checks the same claim from the outside: one set of components, used from React, Vue, Svelte, Solid and Angular in different parts of one games site.

Its conformance suite (`packages/conformance` there) writes one fixture in React, Vue, Svelte, Solid and Angular, in Preact and Lit, and once with no framework, the way each framework's own documentation would have it written, and runs 214 checks against all of them in Chrome, Firefox and WebKit. A check that passes in one of those and fails in another is a difference in Zubra. Nothing in a framework's page works around one: it is reported here as an issue and listed there as a known difference until it is fixed.

| Checked there | In |
|---|---|
| Props, events, two-way binding, slots, named slots arriving and leaving, a dialog, a table, tabs, a component removed and brought back | React, Vue, Svelte, Solid, Angular, Preact, Lit and plain elements |
| Each framework's own features around a component: keyed lists, context through a slot, class and style bindings, lazy loading | all five |
| Portals (`createPortal`, `Teleport`, `Portal`) | React, Vue, Solid |
| Transitions (`Transition`, `transition:`, `animate.leave`) | Vue, Svelte, Angular |
| Kept while off the page (`Activity`, `KeepAlive`) | React, Vue |
| Reactive forms through `zubraModel`: values both ways, validity and touched, `disable()`, `reset()` | Angular |

[The results of its last run](https://journey-to-code-org.github.io/open.parlor/conformance/) are published with the app, with the fixture pages to try by hand. Its first run, on 5.9, found #261, #262, #267, #268 and #269, all fixed in 5.15.0.

It runs on the version of Zubra the app has installed, which can be behind this repository's `main`; the page says which.

## What isn't in a row

- SvelteKit with light-DOM components (Svelte claims every node; components there are `shadow`).
- Next.js elements given React children, server-rendered (React's limit; `docs/server-rendering.md`).
- Qwik (no example yet).
- A framework not listed here is not supported, whatever the element can do in it.
