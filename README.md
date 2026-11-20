<p align="center"><img src="brand/zubra-tile.svg" width="96" height="96" alt="Zubra"></p>

# Zubra

Zubra is a compiler for Web Components. You write a component as HTML with `{expr}` bindings and a `<script>`. Zubra turns it into server-rendered HTML and a small custom element that hydrates that HTML. React, Vue and any other framework can then use the element without integration code.

**[Try it in your browser](https://zubra-js.github.io/zubra/playground/)** · [Tutorial](docs/guide/README.md) · [Reference](docs/reference.md) · [Live demos](https://zubra-js.github.io/zubra/) · [Documentation site](https://zubra-js.github.io/zubra/docs/)

```sh
npm create zubra@latest                          # a working app for your framework, or none
npm create zubra@latest -- --framework server    # a server-rendered app: a Node server, a form, no bundler
```

The app it writes has a starter page of small components to read and copy from (a counter, a list, a form control, async data, slots), a dev server that updates components in place, a browser test and an `AGENTS.md` for coding agents ([what's in it](docs/guide/starter-app.md)).

**Status: 5.x, stable within the major.** The `.zb` format, the CLI and the runtime's public API have no breaking changes before 6.0. The number counts breaking changes, not years in use: Zubra has no users in production yet and follows new standards as they land, so majors have come close together. [Stability](docs/stability.md) says what that means and gives every package a tier.

## A component

```html
<!-- copy-button.zb -->
<script>
  let copied = false                               // state: assigning it updates the DOM

  async function copy() {
    await navigator.clipboard.writeText(text)      // `text` is a prop, by name
    copied = true
    setTimeout(() => (copied = false), 1500)
  }
</script>
<style>
  button.done { color: green; }                    /* scoped to this component, in light DOM */
</style>
<copy-button text label="Copy">                    <!-- the host tag: the element and its props -->
  <button type="button" onclick={copy} class:done={copied}>
    {copied ? "Copied!" : label}
  </button>
</copy-button>
```

```sh
zubra compile copy-button.zb --props props.json   # the HTML a server sends (whitespace aside), for {"text":"npm create zubra"}:
#   <copy-button text="npm create zubra"><button type="button">Copy</button></copy-button>
zubra compile copy-button.zb --emit js             # the custom element that hydrates it
```

```html
<copy-button text="npm create zubra"></copy-button>      <!-- plain HTML -->
```
```tsx
<CopyButton text="npm create zubra" />                   // React or Vue, through @zubra/unplugin: same file, typed
```

The reactivity is the point, not a feature. `let` is state, and the template is bound to it:

```html
<script>
  let count = 0
</script>
<click-counter>
  <button onclick={() => count++}>Clicked {count} times</button>
</click-counter>
```

Nothing re-renders: `count++` updates one text node. The script runs once per element, the way Solid and Svelte 5 work: signals, on Zubra's own engine.

<details>
<summary>The same element written by hand (about 45 lines)</summary>

```js
const template = document.createElement("template");
template.innerHTML = `<style>button.done { color: green; }</style><button type="button"></button>`;

class CopyButton extends HTMLElement {
  static observedAttributes = ["text", "label"];
  #copied = false;
  #timer = null;
  #button;
  #onClick = () => this.copy();              // a stored reference, so removeEventListener works

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    this.#button = this.shadowRoot.querySelector("button");
  }
  get text() { return this.getAttribute("text") ?? ""; }
  set text(v) { this.setAttribute("text", v); }
  get label() { return this.getAttribute("label") ?? "Copy"; }
  set label(v) { this.setAttribute("label", v); }

  connectedCallback() {
    this.#button.addEventListener("click", this.#onClick);
    this.#render();
  }
  disconnectedCallback() {
    this.#button.removeEventListener("click", this.#onClick);
    clearTimeout(this.#timer);
  }
  attributeChangedCallback() { this.#render(); }

  async copy() {
    await navigator.clipboard.writeText(this.text);
    this.#copied = true;
    this.#render();                           // every state change has to remember this
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.#copied = false; this.#render(); }, 1500);
  }
  #render() {
    this.#button.textContent = this.#copied ? "Copied!" : this.label;
    this.#button.classList.toggle("done", this.#copied);
  }
}
customElements.define("copy-button", CopyButton);
```

It needs shadow DOM to scope one style rule, has no server HTML, and has to avoid by hand the two bugs most hand-written elements have (a forgotten `#render()`, a listener removed with a different reference). The compiler writes all of it.
</details>

The by-hand version is the platform's own API with nothing in the way. The compiled output is the same behaviour in two pieces: a short description of this component (the module `--emit js` prints) and one class every component shares (`defineElement` in `runtime/src/element.js`). [Read the output](docs/guide/08-read-the-output.md) maps each rule in the by-hand version to where Zubra handles it.

## Why Zubra

- **One component, every consumer.** The output is a standard custom element with server HTML, typings and React and Vue wrappers, so a component library or design system works in more than one framework, in a CMS, an older app, a static site, or behind a server that isn't JavaScript. If one app on one framework is the only consumer, you don't need it: [Who Zubra is for](docs/who-this-is-for.md) says why, and [What crosses the boundary](docs/what-crosses-the-boundary.md) says which components fit through an element.
- **Nothing is hidden.** `zubra compile` prints the HTML and the JavaScript module it generates, and every part of them exists because of a rule of the platform. [Read the output](docs/guide/08-read-the-output.md) goes through one component's real output and the nine rules behind it.
- **Built on what the platform is standardizing.** Template parts in the shape of DOM Parts, the Context Protocol, form-associated custom elements and declarative shadow DOM, so the runtime shrinks as native features ship. Reactivity follows the TC39 Signals proposal's model on an engine of Zubra's own; the proposal's API itself is an experimental mode (`engine: 'signals'`, see `runtime/README.md`).
- **Measured against the alternatives.** [Compared with Lit and Stencil](docs/compared-with-lit-and-stencil.md) and [Compared with WebUI, FAST, Enhance and WebC](docs/compared-with-html-first.md) say where each is the better choice, with what each sends to the browser and how fast each server renders.

## Packages

Zubra is the compiler and its runtime: `.zb` in, elements, server HTML, typings and framework wrappers out. Everything else is optional and separate, and nothing in the compiler needs it:

| Package | What it adds | Needed when |
|---|---|---|
| `@zubra/unplugin` | `.zb` imports in Vite, Rollup, webpack, esbuild, Rspack; React and Vue wrappers; Astro | Your app has a bundler |
| `@zubra/server` | Components in Express, Fastify, Hono or any template engine; the SSR bridge for meta-frameworks | A JavaScript server renders pages |
| `@zubra/actions` | `'use server'` functions over plain form POST | A component owns a form endpoint |
| `@zubra/sync` | `'use collection'`: state kept in IndexedDB, synced across tabs and devices | A component's state must survive reloads or work offline |
| `@zubra/router` | `'use route'`: a component served as a page, with a server-only `load` | An app with no host framework needs pages |
| `create-zubra`, the VS Code extension, the registry | A starter, editor support, 26 components to copy | Convenience |

Each sibling is a separate install that the compiler reports by name when a component uses a directive it serves ([why the compiler knows them by name](docs/compared-with-lit-and-stencil.md#why-the-compiler-knows-use-server-and-use-collection-by-name)). A compiler alone, with `zubra compile --emit element`, is one file and no dependency.

## Documentation

- **[The guide](docs/guide/README.md)**: a tutorial from a first component to server rendering, forms and local state, with pages for React, Vue, Svelte and Angular developers.
- **[The reference](docs/reference.md)**: every rule of the format and the tools. [Writing a component](docs/reference.md#writing-a-component), [JSX components](docs/reference.md#jsx-components), [Directives](docs/reference.md#directives), [Classes, styles, events and references](docs/reference.md#classes-styles-events-and-references), [Script, state and hooks](docs/reference.md#script-state-and-hooks), [Async data](docs/reference.md#async-data), [Slots](docs/reference.md#slots), [Styles](docs/reference.md#styles), [Events](docs/reference.md#events), [Components using components](docs/reference.md#components-using-components), [Forms](docs/reference.md#forms), [Context](docs/reference.md#context), [Server rendering and hydration](docs/reference.md#server-rendering-and-hydration), [Using components in an app](docs/reference.md#using-components-in-an-app), [Sharing components](docs/reference.md#sharing-components), [Moving in from React](docs/reference.md#moving-in-from-react), [Editors and tooling without Rust](docs/reference.md#editors-and-tooling-without-rust), [One file, no runtime: `--emit element`](docs/reference.md#one-file-no-runtime---emit-element), [Describing components to tools](docs/reference.md#describing-components-to-tools), [Safety](docs/reference.md#safety), [Install the CLI without Node or Rust](docs/reference.md#install-the-cli-without-node-or-rust), [The CLI](docs/reference.md#the-cli), [Standards](docs/reference.md#standards).
- **Topics**: [server rendering](docs/server-rendering.md), [Actions](docs/actions.md), [Sync](docs/sync.md), [the router](docs/router.md), [TypeScript](docs/typescript.md), [security](docs/security.md), [performance](docs/performance.md), [browser support](docs/browser-support.md), [editor support](docs/editor-support.md) and [the framework matrix](docs/framework-matrix.md).
- `CHANGELOG.md` for what each release changed.

## Stability

5.x freezes, until 6.0:
- the authoring formats (`.zb`: script semantics, host tag and flags, `{expr}`, directives, slots, keys, imports, `emit`; JSX components);
- the CLI's commands and options, and the outputs' behaviour;
- the runtime's documented exports.

The generated JavaScript's internal shape (`$define()`'s arguments, parts) is not public API. It is versioned (`abi`): a runtime refuses modules compiled for an `abi` it can't read with an error that says to recompile, instead of misbehaving.

Browser support: `docs/browser-support.md`.

## Repository and tests

- `src/`: the compiler (Rust): scanner, parser, script analysis with oxc, resolver and lowering, HTML renderer, JavaScript and interface emitters, CLI.
- `runtime/`: `@zubra/runtime`, with the React, Vue and Angular adapters and the server registry.
- `plugin/`: `@zubra/unplugin`, with the Astro integration.
- `compiler/`: `@zubra/compiler`, the compiler as WebAssembly; `wasm/` is its Rust shim.
- `editors/`: the language server, the VS Code extension and the browser DevTools extension.
- `create/`: `create-zubra`, the starter (`npm create zubra`), with a template per framework and the example components, `AGENTS.md` and browser test they share (`templates/shared/`).
- `playground/`: the in-browser playground.
- `demos/`: the demo gallery: `demos/build.mjs` builds the landing page, the documentation site, the playground and every static example under one base path, `.github/workflows/pages.yml` publishes it to GitHub Pages, and `demos/shots/` holds every example's screenshot (`demos/screenshots.mjs` for the static ones; the others' tests take theirs with `ZUBRA_SHOTS`).
- `docs/guide/`: the tutorial.
- `site/`: the landing page and the documentation site, built with Eleventy (`npm ci` there first). The page compiles its sample component and its own Copy button (a `.zb` file) when it's built and reads the by-hand version out of this README, so the code it shows is the real output. The docs render the Markdown in `docs/`, this README and the CHANGELOG (`site/src/_data/nav.js` lists the pages, and a link to a file that doesn't exist fails the build). `demos/build.mjs` runs it.
- `docs/who-this-is-for.md`, `docs/what-crosses-the-boundary.md`, `docs/server-rendering.md`: where Zubra fits, which components fit through an element, and the server story with its gaps.
- `registry/`: the components `zubra add` copies, with their accessibility tests.

Install Rust 1.97 or newer and Node 20 or newer.

```sh
cargo test --locked
cargo fmt --all -- --check
cargo clippy --all-targets --locked -- -D warnings
(cd runtime && npm ci && npm test)       # unit tests, incl. Signals differential tests
(cd runtime && npm run test:browser)     # Chromium: components, hydration, slots, events, adapters, leaks, benchmarks
(cd runtime && npm run test:tools)       # manifest schema, TypeScript checks, size budgets
(cd plugin && npm ci && npm test)        # real apps: React, Vue, Svelte, Solid, Lit, Astro, Tailwind; Rollup, webpack, esbuild
(cd compiler && npm test)                # render API (and, with zubra.wasm built, parity with the CLI)
(cd create && npm test)                  # the starter's command line
node --test "registry/test/*.test.js"    # the registry's components: keyboard and screen-reader behaviour
(cd examples/frameworks && npm ci && npm test)  # the framework apps, and every starter's own browser test
node --test "playground/test/*.test.js"  # the playground in Chromium
node demos/build.mjs --base /zubra/ && node --test "demos/test/*.test.js"  # the demo gallery, served as Pages serves it
```

The browser and plugin suites need Playwright's Chromium (`npx playwright install chromium`). `.github/workflows/ci.yml` runs every suite on each push. Behaviour is mutation-checked: each feature's code was deliberately broken in turn to confirm a test fails.

## License

ISC. See `LICENSE`.
