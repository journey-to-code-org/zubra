# One ordering app, twelve ways

The code and numbers behind [Compared on one app](../../compared-on-one-app.md): one slice of an ordering app (a menu with live stock, a bag, a pickup time, checkout and an order page that follows the kitchen live) built in Zubra, five web component libraries and three app frameworks, on one backend, one stylesheet and one set of browser tests.

**This copy can't be run as it is.** Every build calls `shared/slice.js`, the app's backend, which belongs to a private project and isn't here. [`shared/README.md`](shared/README.md) gives its interface. Everything else is as it was measured: each build's own code, the spec, the tests, the measuring script and its results.

| Folder | What |
| --- | --- |
| `zubra/` | `@zubra/server` 5.23.0 on plain Node; live updates through `@zubra/sync` |
| `zubra-stream/` | The same on server-sent events, as the others; no `@zubra/sync` |
| `lit/` | Lit 3.3.3 with `@lit-labs/ssr` 4.1.0, plain Node |
| `enhance/` | `@enhance/ssr` 4.0.3 and `@enhance/element` 1.4.6, plain Node |
| `stencil/` | Stencil 4.45.3's hydrate script, plain Node |
| `fast/` | FAST 3.1.4 declarative templates, rendered by WebUI 3.1.2's `fast-v3` plugin, as FAST's docs recommend |
| `webui/` | WebUI 3.1.2 and its framework, plain Node |
| `sveltekit/` | SvelteKit 3.2.0, Svelte 5.57.3, adapter-node |
| `nextjs/`, `nextjs-tuned/` | Next.js 16.4.6, App Router, React 19.3.1; tuned is `output: 'standalone'` |
| `nuxt/`, `nuxt-tuned/` | Nuxt 4.6.4, Vue 3.5.45; tuned makes one data call per page |
| `SPEC.md` | What the slice is: its pages, posts and markup |
| `contract/` | The eleven browser tests every build passes before it is measured, with JavaScript on and off |
| `measure/measure.mjs` | The measuring script; `measure/RESULTS.md` and `results.json` are its output from 2026-11-18 |
| `shared/` | The stylesheet every build serves, and the backend's interface |

Each `package.json` pins exact versions. Lockfiles are left out.

A correction to any build is welcome as an issue or a pull request: the builds were all written by Zubra's author from each project's documentation, and someone who knows a tool better will see what was missed.
