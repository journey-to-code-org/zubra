# Migrating to 6.0

6.0 changes the engine that tracks and updates state. Zubra's own engine is now the default, and the TC39 Signals API becomes signals mode, which is experimental. Components, templates and the script API stay the same, and so does compiled output. Code compiled by 5.18 or later runs on either engine.

Two server defaults change too, because 6.0 starts a long-term-support line whose defaults stay put: [a server that doesn't set NODE_ENV runs in production mode](#servers-production-unless-you-say-development), and [a sync server reads pages nothing until told what they may read](#sync-reads-are-closed-until-you-open-them).

Update every `@zubra/*` package to 6.0 together, and check the server defaults below.

## Server and Sync defaults

`@zubra/server` and `@zubra/actions` now run in production unless `NODE_ENV=development` or `production: false` explicitly selects development. Production hides server error details from visitors; actions refuse to start if a component doesn't compile. Set development only on trusted development servers.

An unconfigured `createSyncServer()` or Durable Object now refuses page reads as well as writes. Supply `authorize` for the intended access: `({ write }) => !write` restores public reads without page writes; `allowAnyone` permits both and is appropriate only where every visitor may edit. Server-side `write()` and `documents()` are unchanged. The standalone `zubra-sync` binary also refuses page reads and writes unless started with `--open`; put it behind your own authorization or on a trusted network.

## Who needs to read on

Only code that relied on a state being the TC39 proposal's object, or that names its own components `zb-…`. Search your code for these:

- `Signal.subtle.Watcher`, `introspectSources`, `introspectSinks`, `hasSinks`, `hasSources`;
- `Signal.subtle.watched` or `Signal.subtle.unwatched` as option keys to `new Signal.State()` or `new Signal.Computed()` (`{ [Signal.subtle.watched]() {…} }`);
- `globalThis.Signal`, or a `Signal` from another package, such as `signal-polyfill`, used with Zubra's state;
- passing what `state()` or `computed()` returns to another library that expects a TC39 signal;
- a component of your own whose tag starts with `zb-` ([below](#components-whose-tag-starts-with-zb)).

If none of these are in your code, the engine change needs no migration.

## What's different in the default engine

| In 5.x | In 6.0 |
|---|---|
| The runtime used the browser's native `Signal` where one existed. | No `globalThis.Signal` is used, and `isNative` is always `false`. A browser that ships `Signal` changes nothing in your app. |
| `Signal` from `@zubra/runtime` was the whole TC39 API. | It has `State`, `Computed`, `subtle.untrack` and `subtle.currentComputed`. `new Signal.State(0)`, `.get()`, `.set()` and `Signal.subtle.untrack(fn)` work as before. |
| `Signal.subtle.Watcher` and the introspection functions existed. | They're `undefined` in production. In development, using one throws an error that says so and points here. The typings don't declare them. |
| `Signal.subtle.watched` and `Signal.subtle.unwatched` option callbacks ran. | They're never called. In development, `Signal.subtle.watched` throws as above, and a `watched` or `unwatched` option key warns once. |
| A Zubra state worked as a signal for other TC39-based libraries. | It's an instance of Zubra's own `Signal.State`, not another library's. |
| The Signals Inspector showed Zubra apps. | It shows them in signals mode only. |

These keep working on both engines:

- `x instanceof Signal.State`, when `Signal` is the one from `@zubra/runtime`;
- Zubra's own bridges: `subscribe`, `toStore`, React's and Vue's `useSignal`, and `@zubra/sync`;
- Zubra DevTools.

## Keeping 5.x's behaviour: signals mode

For code that needs the TC39 API, turn on signals mode wherever the runtime is chosen:

```js
// Vite, Rollup, esbuild, webpack, Rspack
zubra({ engine: 'signals' })

// @zubra/server, on Node or at the edge
createZubra({ components, engine: 'signals' })

// @zubra/server/build
await buildRuntime({ components, engine: 'signals' })
await buildApp({ components, engine: 'signals' })
```

`engine` is `'zubra'` (the default) or `'signals'`; any other value is an error, and a misspelled option name (`signal: true`) is warned about. 6.0.0-rc.0 called it `signals: true`, which still works and warns in development.

The engine is then the one 5.x had: the TC39 API, native where the browser has it, with Zubra's implementation otherwise.

Signals mode has these limits:

- **It is experimental.** It may change in any release ([Stability](stability.md)).
- **The runtime is served file by file in production.** That's because `@zubra/server`'s one-file builds contain Zubra's engine.
- **Builds and servers must agree.** A runtime from `buildRuntime()` or `buildApp()` has to be built with the same `engine` as the server that sends it, or the server refuses it.
- **At the edge, serve `signal-tc39.js` as `signal.js`.** Serve `dist/production` that way, and don't use `bundle`.

## Servers: production unless you say development

**A server that doesn't set NODE_ENV now runs in production mode; set NODE_ENV=development or pass `production: false` for development.** In 5.x `@zubra/server` and `@zubra/actions` were in development mode unless `NODE_ENV` was `production`, so a deployment that forgot it sent visitors error messages, stacks, source paths and the runtime's DevTools build. Now development is opt-in, as `@zubra/server/edge` always was:

| `NODE_ENV` | 5.x | 6.0 |
|---|---|---|
| unset, empty, `staging`, `test`, … | development | production |
| `production` | production | production |
| `development` | development | development |

`production: false` (or `true`) still decides it outright. In development the server says so once at start (`@zubra/server: development mode (NODE_ENV=development)`). The sync server's refused-read warning follows the same rule.

What to do: in a dev script, set it. `npm create zubra`'s server starter does it with a flag the server reads, so it works on Windows' cmd too:

```json
"dev": "node --watch-path=src --watch-path=server.js server.js --dev",
"start": "node server.js"
```

```js
if (process.argv.includes('--dev')) process.env.NODE_ENV = 'development';
```

(`node --env-file=.env.development server.js`, with `NODE_ENV=development` in that file, works too.) Tests that check development behaviour (an error page with the message, `reload`) set `NODE_ENV=development` or pass `production: false`. A server that passed `cache: process.env.NODE_ENV === 'production'` should pass `cache: true` instead: in development an edit to a component is still picked up, since the folder is checked first.

## Sync: reads are closed until you open them

**`createSyncServer()` without `authorize` now lets pages read nothing**, as it already let them write nothing. In 5.x every page could pull every collection in the log. Open what each page needs:

```js
import { createSyncServer, allowReads, allowAnyone } from '@zubra/sync/server';
createSyncServer({ authorize: allowReads(['menu', 'stock']) });   // these collections, read only
createSyncServer({ authorize: allowReads() });                    // every collection, read only (5.x's default)
createSyncServer({ authorize: allowAnyone });                     // read and write everything
```

A server that already passes `authorize` is unchanged: it was deciding reads already (`kind: 'read'`). A Durable Object without an `authorize()` reads nothing too. The `zubra-sync` binary takes `--read <collection>` (repeatable) or `--read-all`; `--open` still opens reads and writes. In development the server names the collection a page was sent nothing of, and the `allowReads([...])` that would open it.
## Components whose tag starts with zb

The `zb-` prefix is reserved for Zubra's own elements (the directives, `<zb-outlet>` and `<zb-context>`). In 5.x an unknown `<zb-…>` element compiled into an element nothing defines, so a typo such as `<zb-iff>` went unnoticed. In 6.0 it is a compile error with the nearest built-in as help. A component of your own named `zb-…` can't be used from another component's template any more: rename it (`<zb-card>` to `<app-card>`, say), in its host tag and wherever it's used.
## A codemod?

There isn't one: there's nothing to rewrite mechanically. The changes above are each a choice. You can move code off the Watcher, or keep it and turn on signals mode.

## Everything else in 6.0

The rest of 6.0 is additions and fixes. `CHANGELOG.md` has the full list.
