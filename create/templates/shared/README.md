# {{title}}

A {{framework}} app using [Zubra](https://github.com/zubra-js/zubra) web components.

```sh
npm install
npm run dev     # then edit src/components/hello-counter.zb: it updates in place
npm run build
npm test        # builds the app and clicks through it in Chromium (run `npx playwright install chromium` once)
```

## What's here

- `src/components/` holds the components: one `.zb` file each, with its script, styles and template.
- The Zubra plugin (`@zubra/unplugin`) compiles them when they're imported, and writes their typings next to them.
- The elements are standard custom elements, so they also work in plain HTML, other frameworks and server-rendered pages.
- `AGENTS.md` and `skills/` tell a coding agent how to write and use the components, so it doesn't have to learn Zubra from the source. `AGENTS.md` is also the quickest summary for a person.

## The page you see

The starter page is made of the components in `src/components/`, and each one is an example to read and copy from:

| File | Shows |
|---|---|
| `hello-counter.zb` | Props, state, and a two-way prop the page binds to |
| `todo-list.zb` | Lists, conditions and input |
| `rating-input.zb` | An element that is a real form control |
| `async-tip.zb` | Data that arrives later, with loading and error states |
| `example-card.zb` | Slots |
| `zubra-examples.zb` | Components using components |

Open one while `npm run dev` runs, change it and save.

## Making it yours

`zubra-welcome.zb`, `zubra-examples.zb` and `example-card.zb` are only the starter page. Delete them, take their tags and imports out of the page, and delete the examples test in `test/app.test.js`. Then add your own: a new `src/components/my-thing.zb`, imported where it's used. `npx zubra add --list` shows tested, accessible components you can copy in to start from.

The [tutorial](https://zubra-js.github.io/zubra/docs/) goes from here to forms, async data and server rendering.
