# Migrating to 6.0

6.0 changes one thing: the engine that tracks and updates state. Zubra's own engine is now the default, and the TC39 Signals API becomes signals mode, which is experimental. Components, templates and the script API stay the same, and so does compiled output. Code compiled by 5.18 or later runs on either engine.

Most apps need no change. Update every `@zubra/*` package to 6.0 together, and you're done.

## Who needs to read on

Only code that relied on a state being the TC39 proposal's object, or that names its own components `zb-…`. Search your code for these:

- `Signal.subtle.Watcher`, `introspectSources`, `introspectSinks`, `hasSinks`, `hasSources`;
- `Signal.subtle.watched` or `Signal.subtle.unwatched` as option keys to `new Signal.State()` or `new Signal.Computed()` (`{ [Signal.subtle.watched]() {…} }`);
- `globalThis.Signal`, or a `Signal` from another package, such as `signal-polyfill`, used with Zubra's state;
- passing what `state()` or `computed()` returns to another library that expects a TC39 signal;
- a component of your own whose tag starts with `zb-` ([below](#components-named-zb)).

If none of these are in your code, nothing changes for you.

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

## Components named `zb-…`

The `zb-` prefix is reserved for Zubra's own elements (the directives, `<zb-outlet>` and `<zb-context>`). In 5.x an unknown `<zb-…>` element compiled into an element nothing defines, so a typo such as `<zb-iff>` went unnoticed. In 6.0 it is a compile error with the nearest built-in as help. A component of your own named `zb-…` can't be used from another component's template any more: rename it (`<zb-card>` to `<app-card>`, say), in its host tag and wherever it's used.

## A codemod?

There isn't one: there's nothing to rewrite mechanically. The changes above are each a choice. You can move code off the Watcher, or keep it and turn on signals mode.

## Everything else in 6.0

The rest of 6.0 is additions and fixes. None of them changes something you already rely on. `CHANGELOG.md` has the full list.
