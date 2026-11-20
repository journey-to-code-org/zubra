# {{title}}

A server-rendered app using [Zubra](https://github.com/zubra-js/zubra) web components: a Node server that sends pages with the components already in the HTML, and a form that runs a function on the server. No bundler and no build step.

```sh
npm install
npm run dev     # http://localhost:3000; then edit src/components/hello-counter.zb and save: it updates in place
npm start       # the same server for production (NODE_ENV=production)
npm test        # starts the server and uses the page in Chromium, with JavaScript and without (run `npx playwright install chromium` once)
```

## What's here

- `server.js` is the whole server, about ninety lines with its comments (sixty without): `@zubra/server` renders the page and serves the components' browser modules, and `@zubra/actions` runs the functions the components mark `'use server'`.
- `src/components/` holds the components: one `.zb` file each, with its script, styles and template. The server compiles them as they're asked for.
- `src/notes.js` is the data, an array in memory. Put a database behind it.
- The page works before its JavaScript arrives, and the form works with JavaScript off. `npm test` checks both.
- `AGENTS.md` and `skills/` tell a coding agent how to write the components and the server, so it doesn't have to learn Zubra from the source. `AGENTS.md` is also the quickest summary for a person.

## The page you see

Each component is an example to read and copy from:

| File | Shows |
|---|---|
| `guest-book.zb` | A form that runs a `'use server'` function, and a list that follows its answer |
| `hello-counter.zb` | Props, state, and continuing in the browser from what the server rendered |
| `todo-list.zb` | Lists, conditions and input |
| `rating-input.zb` | An element that is a real form control |
| `async-tip.zb` | Data that arrives later, with loading and error states |
| `example-card.zb` | Slots |
| `zubra-examples.zb` | Components using components |

## Making it yours

`zubra-welcome.zb`, `zubra-examples.zb` and `example-card.zb` are only the starter page. Delete them, take them out of `home()` in `server.js`, and delete the examples test in `test/app.test.js`. Then add your own: a new `src/components/my-thing.zb`, rendered with `page.render('my-thing', props)`. `npx zubra add --list` shows tested, accessible components you can copy in to start from.

For more than one page, `@zubra/router` adds routes, layouts and a `load` per page to this same server: see [the router's page](https://zubra-js.github.io/zubra/docs/router/) in the documentation.
