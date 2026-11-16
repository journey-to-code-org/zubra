# {{title}}

A {{framework}} app with [Zubra](https://github.com/journey-to-code-org/zubra) components. A Zubra component is one `.zb` file (a script, styles and a template) that compiles to a standard custom element, so the same file works in plain HTML, in any framework and on a server.

## Commands

`npm run dev` runs the app with hot reload: a saved `.zb` file updates in place and keeps its state. `npm run build` builds it. `npm test` builds the app and uses it in Chromium (`npx playwright install chromium` once). `npx zubra check src/components/<name>.zb` checks one component and prints each error with a caret and a fix; it should print `no errors` after every change.

## Where things are

| Path | What |
|---|---|
| `src/components/*.zb` | The components. The file's name is the element's tag. |
| `src/style.css` | The page's styles, and the colours as custom properties (`--text`, `--muted`, `--line`, `--panel`, `--code`, `--accent`, `--page`) that the components read. |
| The page itself | The framework's entry in `src/` (or `index.html` with no framework, `src/pages/` with Astro). It imports the components and uses their tags. |
| `test/app.test.js` | The browser test. Add to it for each component you write. |
| `vite.config.js` (`astro.config.mjs`) | `@zubra/unplugin` is what compiles `.zb` imports. |
| `skills/` | How to write a component and how to use one from this app's framework, in full. |

## The components that came with the app

Each is a small, commented example of one idea. Copy the shape from the one closest to what you're building.

| File | Shows |
|---|---|
| `hello-counter.zb` | Props with defaults, state, a derived value, a two-way prop (`count:model`) the page binds to. |
| `todo-list.zb` | A list (`zb-each` with `key`), conditions (`zb-if` / `zb-else`), text input, mutating state. |
| `rating-input.zb` | A form control (`form-associated`): submits under its `name`, resets, validates. |
| `async-tip.zb` | Async data: `resource()` and `<zb-await>` with pending, then and catch. |
| `example-card.zb` | Slots: a default slot with fallback, a named slot, `hasSlot()`. |
| `zubra-examples.zb` | Components using components (`import './todo-list.zb'`), and a parent reading a child form. |
| `zubra-welcome.zb` | A component that is only props and markup. |

`zubra-welcome.zb`, `zubra-examples.zb` and `example-card.zb` are the starter page. When the app gets its own page, delete them, take their tags and imports out of the page, and delete the examples test in `test/app.test.js`. Keep or delete the rest as the app needs.

## Tasks

| Task | Read first |
|---|---|
| Write or change a component | `skills/zubra-component/SKILL.md` |
| Use a component from the page ({{framework}}) | `skills/zubra-consume/SKILL.md` |

## A component in one screen

```html
<!--
  What it is, in a sentence: this comment becomes its description in the typings.
  @fires valuechange - The value changed; `detail` is the new value.
-->
<script>
  import { onMount } from '@zubra/runtime'

  let open = false                        // a top-level let is state: assign or mutate it
  const label = open ? 'Close' : 'Open'   // a const that reads state or props stays in sync
  function toggle() { open = !open }      // props are plain names here too: `value = 3`
  onMount(() => () => {})                 // runs in the browser; may return a cleanup
</script>
<style>
  button { font: inherit; }               /* scoped to this component */
</style>
<my-thing value:model={0} max={5} label-text="Pick">   <!-- the host tag: the element and its props -->
  <button type="button" onclick={toggle} class:on={open}>{label}</button>
  <p zb-if={open}>{labelText}: {value} of {max}</p>
</my-thing>
```

- **The host tag declares the props**, each with its default: `max={5}` is a number, `label-text="Pick"` a string, `items={[]}` an array, a bare `name` is required. A kebab-case attribute is a camelCase prop (`label-text` → `labelText`).
- **`name:model`** makes a prop two-way: assigning it fires `<name>change` with the new value, which is what frameworks bind to. Use it for a control's value; don't fire that event by hand.
- **Nothing re-renders.** The script runs once per element, and an assignment updates only the text, attribute or list row that read it.
- **`let x = prop` reads the prop once.** `{prop}` in the template and a `const` computed from it follow the prop; for state that should start over when the prop changes, `let x = from(prop)` (from `@zubra/runtime`).
- **Template**: `{expr}` in text and attributes; `onclick={fn}` with modifiers (`onsubmit.prevent`, `onkeydown.enter`); `class:name={bool}`; `style:prop={value}`; `<zb-each items={list} as="item" key={item.id}>`; `zb-if` / `zb-else-if` / `zb-else` on neighbouring elements; `<zb-slot>` for children.
- **Events out**: `emit('itemselect', detail)` from `@zubra/runtime`, the name lowercase with no dashes.
- **Other components**: `import './other-thing.zb'` in the script, then `<other-thing>` in the template. Without the import the tag is an unknown element: it stays empty and nothing warns.
- **TypeScript**: `<script lang="ts">` with an `interface Props` types the props. One file at a time: the others can stay as they are.

## Using a component from the page

Importing the `.zb` file defines the element. In React and Vue the import is also a typed component (`<HelloCounter count={count} onCountChange={…} />`, `v-model:count`); in Svelte, Solid, Preact, Lit, Angular and plain HTML you use the tag and set props as properties and listen for its events. `skills/zubra-consume/SKILL.md` has the exact spelling for each.

From a plain script: `el.count = 3` (the camelCase property) or `el.setAttribute('count', '3')`, and `el.addEventListener('countchange', (event) => event.detail)`. A misspelt property (`el.cuont = 3`) is an ordinary property nobody reads, with no error, so check the spelling first when an update does nothing.

## Rules that save time

- Name every element with a hyphen, and put it at `src/components/<tag>.zb`.
- Give internal elements specific class names (`tl-left`, not `active` or `card`): in light DOM the page's own CSS reaches in.
- Always give `zb-each` a `key` when rows can be removed or reordered.
- A component takes data in through props and sends it out through events. If it would need the app's store or router, that part belongs in the page's own code, with Zubra components inside it.
- Don't edit the generated typings next to the components (`*.d.zb.ts`); they're rewritten from the `.zb` file.
- After changing a component: `npx zubra check` on it, then `npm test`.

The full reference is https://github.com/journey-to-code-org/zubra#readme, and the tutorial is https://journey-to-code-org.github.io/zubra/docs/.
