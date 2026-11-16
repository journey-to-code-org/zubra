# The starter app

```sh
npm create zubra@latest my-app
cd my-app
npm install
npm run dev
```

It asks for a framework (none, React, Vue, Svelte, Solid, Preact, Lit, Angular or Astro) and whether components should be TypeScript. `npm run dev` opens a page made of small example components. Each one is a file you can open, change and save while the page is running: it updates in place and keeps its state.

This page says what's in the app, so you can go straight to the part you need. The [tutorial](01-first-component.md) explains each idea in turn.

## The page

Three things, top to bottom:

1. **A welcome**, with the app's name and the framework it's used from.
2. **A counter the page binds to.** The counter is a Zubra component; the number under it ("React sees 2") is your framework's own state, kept in step through the counter's two-way `count` prop. This is the line to look at to see how a component is used from your framework: it's in the framework's entry file, `src/App.jsx`, `src/App.vue`, `src/App.svelte`, `src/app.ts`, `src/main.js`, `index.html` or `src/pages/index.astro`.
3. **Four example cards**, each a live component with the few lines it turns on and the file it lives in.

## The components

All in `src/components/`, each with a comment at the top saying what it shows.

| File | Shows | Tutorial |
|---|---|---|
| `hello-counter.zb` | Props with defaults on the host tag, `let` as state, a derived `const`, and a two-way prop (`count:model`) | [Your first component](01-first-component.md), [Two-way props and events](03-props-and-events.md) |
| `todo-list.zb` | A list (`zb-each` with a `key`), conditions (`zb-if`, `zb-else`), text input, mutating state | [Templates](02-templates.md) |
| `rating-input.zb` | An element that is a real form control: it submits under its `name`, resets with the form, validates | [Forms](05-forms.md) |
| `async-tip.zb` | Data that arrives later: `resource()` and `<zb-await>` with its pending, then and catch parts | [Async data](06-async-data.md) |
| `example-card.zb` | Slots: a default slot with fallback content, a named slot, and `hasSlot()` | [Composition and slots](04-composition.md) |
| `zubra-examples.zb` | Components using components (it imports the four above), and a parent reading a child's form | [Composition and slots](04-composition.md) |
| `zubra-welcome.zb` | A component that is only props and markup | |

With `--typescript`, `hello-counter.zb` is `<script lang="ts">` with an `interface Props`, and `npm run check` type-checks every component, TypeScript or not. A file becomes TypeScript when you add `lang="ts"` to its script, one at a time.

## The rest of the app

| Path | What |
|---|---|
| `src/style.css` | The page's styles. The colours are custom properties (`--text`, `--accent`, `--panel`, …) that the components read, with a dark set under `prefers-color-scheme: dark`. |
| `test/app.test.js` | A browser test: it builds the app, opens it in Chromium, clicks the counter and uses each example. `npm test` runs it (`npx playwright install chromium` once). |
| `vite.config.js` (`astro.config.mjs`) | `@zubra/unplugin`, which compiles `.zb` files as they're imported and writes their typings beside them. |
| `AGENTS.md` | The app on one page, written for a coding agent and just as useful to a person: the commands, where things are, what each example shows, a whole component with every part labelled, how to use one from the page, and the rules that save time. |
| `skills/` | The longer instructions `AGENTS.md` points to: writing a component, and using one from each framework. |

## Making it yours

`zubra-welcome.zb`, `zubra-examples.zb` and `example-card.zb` are only the starter page. When you have a page of your own:

1. Delete those three files, and take their tags and imports out of the framework's entry file.
2. Delete the examples test in `test/app.test.js` (the counter's test stays, as a model for your own).
3. Keep the other components that are useful to you and delete the rest.

Then add a component: a new `src/components/my-thing.zb`, imported where it's used. A component that uses another imports it (`import './other-thing.zb'` in its script). `npx zubra add --list` lists tested, accessible components you can copy into `src/components/` and change.

**Next:** [Your first component](01-first-component.md).
