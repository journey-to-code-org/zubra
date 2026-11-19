# Zubra DevTools

A **Zubra** pane in the browser's Elements panel (Chrome, Edge, Firefox). Select any node a Zubra component renders, and it shows:

- **The component**: its host tag and its `.zb` file and line. Click it to open the file there in your editor.
- **Props and state**, by the names in the script, with their current values.
- **Bindings**: those on the selected node first, then the rest of the component. Each is named as the DOM operation it performs (`textContent = …`, `setAttribute('value', …)`, `classList.toggle('done', …)`, `addEventListener('click', …)`), with the `.zb` line that wrote it and the named signals it reads (`count`, `items[0].done`). That's what the compiled output does, which is the platform you're learning.
- **What a parent binds onto a child**, when the selected node is a component's host.
- **The last update**: what was written, and which bindings re-ran (marked *ran*), each with **why**: the signals it reads that the update wrote, followed through the computeds between them (`re-ran because doubled ← count changed`).
- **Signals**: the component's props, state and computeds, each with its value, how many times it has changed, what reads it now (bindings by their DOM operation, computeds by name), and what a computed reads.
- **Live**: the effects in the component, the components on the page, and the effects made since the pane connected that are still alive, with how that count moved over the last updates and a small line of it. A count that only grows while you add and remove things is worth a look.
- **Updates**: the page's last 50 updates, newest first: what each wrote (from and to), which bindings and effects it re-ran, in which component, and how long it took.

It's read-only, and it follows the page: it re-reads when the selection changes and when the page updates.

## Try it

Install it, then open the [playground](https://journey-to-code-org.github.io/zubra/playground/): its previews are development builds, so select an element in one and the Zubra pane shows it. Clicking a line selects it in the playground's editor.

## What it needs

A development build. `@zubra/unplugin` makes one in Vite's dev server: it compiles each component with `--devtools` (which records the source lines and names) and Vite serves the runtime's development build (which has the hook). "Open in editor" goes through Vite's own `/__open-in-editor`, so it opens the editor it finds running (set `LAUNCH_EDITOR`, for instance to `code`, to choose one).

Outside Vite, compile with `zubra compile x.zb --emit js --devtools` and import `@zubra/runtime` without the `production` condition. An ordinary build still shows the component, its props and its bindings, without lines or the script's names.

A production build has none of it: the compiler adds nothing without the flag, and the runtime's `production` build has no hook.

## How it reads the page

Through `globalThis.__ZUBRA_DEVTOOLS__`, which the runtime's development build defines (`runtime/src/devhook.js` records; `runtime/src/devtools.js`, loaded when the pane connects, reads). The pane calls `inspectedWindow.eval` with `$0`, the selected node, and gets plain JSON back. No content script, no permissions, nothing sent anywhere. Dependencies and readers come from the engine's own `sources()` and `sinks()` (`runtime/src/signal.js`), so the view is the same on Zubra's engine and in signals mode (`signals: true`, on the TC39 API), where it reads the proposal's own introspection; only the change counts need Zubra's engine (signals mode shows none). The header says which engine the page runs.

The page's count comes from the development runtime alone, from when the pane connects (so a page that never opens it pays nothing): it counts effects as they're made and disposed, and, through a `FinalizationRegistry`, as they're garbage-collected (a removed element's effects are paused, not disposed, in case it comes back, so they leave the count when the browser collects them). None of this is in the production build.

## Install

Until it's in the stores, load it unpacked from this folder:

- **Chrome or Edge**: open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose **Load unpacked**, and pick `editors/devtools`.
- **Firefox** (140 or later): open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and pick `editors/devtools/manifest.json`.

Then open DevTools on your app, select an element, and find **Zubra** beside Styles and Computed.

To package it for a store: `cd editors/devtools && npm run pack`, which writes `editors/zubra-devtools-<version>.zip` (manifest.json at its root, without the tests, scripts, README and package.json). It uses Node alone, so it works on Windows too, where there's no `zip` command. The same zip goes to the Chrome Web Store, Edge Add-ons and Firefox Add-ons. Before uploading to addons.mozilla.org, `npx web-ext lint --source-dir editors/devtools --self-hosted` runs the same checks its validator does (CI runs it too). The manifest declares that the extension collects no data (`data_collection_permissions`), which addons.mozilla.org requires of new add-ons.

## Tests

`npm test` here checks the manifest and the pane's rendering. The pane against a live page, with the runtime's hook, runs with the runtime's browser suite (`runtime/test/browser/devtools.test.js`).
