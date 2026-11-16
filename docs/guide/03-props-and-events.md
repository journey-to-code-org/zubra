# 3. Two-way props and events

Components talk to the outside the way built-in elements do: **properties in, DOM events out**. That's why one component works in every framework without glue code.

## Events

```html
<script>
  import { emit } from '@zubra/runtime'

  function pick(color) {
    emit('colorpick', color)
  }
</script>
<color-picker colors={["red", "green", "blue"]}>
  <zb-each items={colors} as="color" key={color}>
    <button type="button" style:background={color} aria-label={color} onclick={() => pick(color)}></button>
  </zb-each>
</color-picker>
```

- `emit(name, detail)` fires a `CustomEvent` from the element. It bubbles, and `detail` carries the value.
- Calling `emit` declares the event: it appears in the typings and the docs. Here it's `colorpick: CustomEvent<unknown>`, because `color` is a variable; in a `<script lang="ts">`, `emit<string>('colorpick', color)` makes it `CustomEvent<string>`. There's nothing to register. In any script, `@fires {string} colorpick - text` in the description comment says it too, and `@prop {Type} name - text` types a prop.
- Names are lowercase, like the platform's own (`colorpick`, not `colorPick`): every framework can listen to those declaratively. A camelCase name is an error that suggests the right one.
- `before…` events are cancelable: `if (!emit('beforeclose')) return` stops when a listener called `preventDefault()`.

Listening, in each place the element is used:

| Where | |
|---|---|
| Plain HTML | `el.addEventListener('colorpick', (event) => …)` |
| Another Zubra component | `<color-picker oncolorpick={(event) => …}>` |
| React (through the plugin) | `<ColorPicker onColorpick={(event) => …} />` |
| Vue | `<ColorPicker @colorpick="…" />` |
| Svelte, Preact | `oncolorpick={(event) => …}` |
| Solid | `on:colorpick={(event) => …}` |
| Lit | `@colorpick=${(event) => …}` |
| Angular | `(colorpick)="…"` |

## Two-way props

Most interactive components have a value the user changes: a toggle's `checked`, a stepper's `value`. Mark that prop with `:model`:

```html
<toggle-switch checked:model={false} label="Notifications">
  <button type="button" role="switch" aria-checked={checked ? "true" : "false"} onclick={() => (checked = !checked)}>
    {label}
  </button>
</toggle-switch>
```

Now, whenever the component assigns `checked`, the element fires `checkedchange` with the new value. Nothing fires when the value is set from outside, because the caller already knows it. Frameworks bind to exactly that pair:

| | |
|---|---|
| Vue | `<ToggleSwitch v-model:checked="enabled" />` (and `v-model` for a `value` prop) |
| React | `<ToggleSwitch checked={enabled} onCheckedChange={(event) => setEnabled(event.detail)} />` |
| Svelte | `<toggle-switch checked={enabled} oncheckedchange={(event) => (enabled = event.detail)}>` |
| Angular | `<toggle-switch zubraModel="checked" [(ngModel)]="enabled">` with `ZubraModel` |

## Setting a prop from outside

A prop has one name and three spellings, and each place uses its own:

```html
<!-- stock-line.zb -->
<script>
  const words = leftNow > 0 ? `${leftNow} left` : 'Sold out'
</script>
<stock-line item="" left-now={0}>
  <p>{words}</p>
</stock-line>
```

| Where | Spelling |
|---|---|
| The host tag, in the `.zb` file and in a page's HTML | the attribute, kebab-case: `left-now="5"` |
| The component's script and template | the prop, camelCase: `leftNow` |
| `page.render()` on the server, and a framework's props | the prop: `page.render('stock-line', { leftNow: 5 })` |
| A script on the page | the property: `el.leftNow = 3` (or the attribute: `el.setAttribute('left-now', '3')`) |

The compiler and the server check the names they see: `page.render('stock-line', { 'left-now': 5 })` is an error that suggests `leftNow`. The browser can't: `el.leftnow = 3` is an ordinary property on the element that nothing reads, and nothing says so. When an update from a script does nothing, check the spelling first.

Anything on the page can keep a server-rendered component up to date that way, with no framework and no `@zubra/sync`. Here a page script follows the server's event stream:

```js
// live.js, loaded by the page with <script type="module" src="/live.js">
new EventSource('/live').onmessage = (event) => {
  for (const [key, left] of JSON.parse(event.data)) {
    const line = document.querySelector(`stock-line[item="${key}"]`);
    if (line) line.leftNow = left;
  }
};
```

A value set before the component's module has loaded is taken over when the element starts, with one exception today: if the server wrote that prop as an attribute on the tag (it does whenever the value isn't the default), the attribute is applied afterwards and wins ([#326](https://github.com/journey-to-code-org/zubra/issues/326)). A script that may run that early can wait: `await customElements.whenDefined('stock-line')` before its first update.

What follows the new value depends on how the script read the prop:

| In the script | When the prop is set from outside |
|---|---|
| `{leftNow}` in the template, or a `const` computed from it (`words` above) | Follows it. A component that only shows what it's given needs nothing else. |
| `let left = leftNow` | Doesn't. `left` is state now: it read the prop once, when the element started. |
| `let left = from(leftNow)` | Follows it, until the component assigns `left`; the next new `leftNow` starts it over. |

So `from()` is for state the component changes itself and that should still start over from the prop, which is the next section.

## State that starts from a prop

`let left = seconds` reads the prop once: if the app later sets a new `seconds`, `left` keeps counting from the old one. For state that should start over when a prop changes, use `from()`:

```html
<script>
  import { from } from '@zubra/runtime'
  let left = from(seconds)            // follows `seconds`, until the timer counts down
  let running = from(seconds, false)  // `false`, and `false` again on a new length
</script>
<focus-timer seconds={1500}>
  <button onclick={() => (running = !running)}>{running ? 'Pause' : 'Start'}</button>
  <time>{left}</time>
</focus-timer>
```

Assigning `left` works like any `let`. When `seconds` changes, the assignment is dropped and `left` is the new `seconds`. On the server it renders as the prop's value.

## Typing props

A prop's type comes from its default: `count={0}` is a `number`, `label="Hi"` a `string`. When the default doesn't say enough (`null`, `[]`), declare the type in a TypeScript script:

```html
<script lang="ts">
  type Size = 'small' | 'medium' | 'large'
  declare const size: Size
  declare const value: number | null
</script>
<number-field size="medium" value:model={null}>…</number-field>
```

The declaration only types the prop (the default still comes from the host tag), and the typings, the manifest and other components' checks all use it.

## Signals that read like values

For state shared between components, or anything outside one element, `state()` and `computed()` from `@zubra/runtime` make explicit signals. A `const` holding one reads like a value, in the script and the template:

```html
<script>
  import { inject } from '@zubra/runtime'
  import { session } from '../session.js'

  const user = inject(session)                 // a signal that follows the nearest provider
  const greeting = `Hi, ${user?.name}`         // derived: stays in sync
</script>
<user-badge>
  <span>{greeting}</span> <small>{user.email}</small>
</user-badge>
```

`user.email` means `user.get().email`. To change a `state()`, call `.set(…)`. To pass the signal itself to something that takes one (`watch()`, `formValue()`, `provide()`), write `signal(user)`.

**Next:** [Composition and slots](04-composition.md)
