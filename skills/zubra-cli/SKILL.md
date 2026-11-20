---
name: zubra-cli
description: Run the Zubra compiler from a shell or a build: check a component, compile it to HTML or JavaScript, publish a component library, copy in a registry component, convert a React component, or drive the compiler as a long-lived process from another language. Use for any `zubra …` or `npx zubra …` command.
---

Two binaries share the name and take the same command lines: the **native CLI** (`zubra`: a release binary, or `cargo build --release` into `target/release/zubra`) and the **npm CLI** (`npx zubra`, from `@zubra/compiler`, WebAssembly, no Rust). `check`, `compile`, `convert`, `fmt`, `request` and `serve` take the same flags, values, help and exit codes in both. `build`, `add`, `types`, `mcp` and `check --types` need Node, so they are in the npm CLI only; the native one says so (exit 2). In a project made by `npm create zubra`, use `npx zubra`. In this repository, `target/release/zubra` (or `cargo run --release --`).

`zubra --help` lists every command with every flag; `zubra <command> --help` one command's. Exit codes: **0** success (warnings included), **1** errors in the input, **2** a usage error (unknown command, flag or value: the message says what was meant). Every error and warning has a stable code (`error[ZB2001]: …`, `"code": "ZB2001"` in `--format json`), listed in https://github.com/zubra-js/zubra/blob/main/docs/diagnostics.md: match on the code, not the message. No framework is `--framework vanilla` (also `element`, `none`, `plain`).

## Commands

| | |
|---|---|
| `zubra check <file \| dir>... [--format json] [--server] [--client] [--stdin] [--deny-warnings]` | Errors and warnings with carets, codes and suggested fixes; exit 1 on an error (on a warning too with `--deny-warnings`). `--server` also reports every part the server can't render (an error for `checked`, `selected`, `value` and `disabled`). `--client` says whether each component needs its module in the browser, and why. `--format json` for tooling. |
| `npx zubra check --types <file \| dir>... [--format json]` | The project's own TypeScript checks each `<script lang="ts">` component: the script, every template expression, child props and event handlers; errors on `.zb` lines (`TS2322` and the like); exit 1 on an error. Needs `typescript` in the project. Run it in CI, and after changing a TypeScript component's types. |
| `npx zubra types [file \| dir]... [--dir .zubra/types] [--framework react\|vue\|svelte\|solid\|solid2\|vanilla]` | Writes each component's typings (`x.d.zb.ts`) into a folder of the app that mirrors it, as `@zubra/unplugin`'s `dts: { dir }` does during a build, so `tsc` can check a fresh checkout before one. Run it in the app's folder; the framework is the one in its `package.json`. |
| `zubra fmt <file \| dir>... [--check]` | Lays `.zb` files out (indentation, tidy tags) without changing what they compile to; `--check` fails if a file would change. Run it after editing a component. |
| `zubra compile <file>` | Server HTML. `--props props.json` gives prop values (required props need one); `--slots slots.json` gives slot content (`--slots-html` to keep it as HTML); `--partial` leaves browser-only parts empty instead of failing. |
| `zubra compile <file> --emit js` | The custom element module (`--client-only` without hydration). `--emit element` is the same element with no runtime; `--emit dts\|manifest\|html-data\|interface\|css\|server\|tsx` gives the typings (`--framework react\|vue\|svelte\|solid\|solid2\|vanilla` types the default export as that framework's wrapper, or the element), Custom Elements Manifest, VS Code data, prop/event interface, stylesheet, server renderer, or the TypeScript `check --types` checks. |
| `npx zubra build --lib <dir> [--out dist] [--name @acme/ui] [--version x.y.z] [--watch]` | A publishable package: an ES module per element, `react` and `vue` entries, typings, `custom-elements.json`, a `skills/` folder for agents, and `package.json` with `exports` and `@zubra/runtime` as a peer. |
| `npx zubra mcp [custom-elements.json \| components dir \| package]...` | An MCP server (standard input and output) describing the components to coding agents: list, describe, usage per framework, and a check of written markup. For a client's MCP config, not for running by hand. |
| `npx zubra build --embed <dir> [--out embed] [--name acme-widgets] [--base <url>]` | For sites with no build step: one flat folder of ES modules (one `<script type="module">` defines every component), an HTML snippet per component, a WordPress plugin (a block and a shortcode per component), a Shopify theme app extension (an app block per component). Components must import only `@zubra/runtime` and files beside them. |
| `npx zubra add <name>... [--dir src/components]`, `npx zubra add --list` | Copy a registry component (twenty-six tested, accessible ones) into the project to own. |
| `zubra convert <Component.jsx \| my-element.js> [--prefix word] [--component Name] [--as zubra] [--out file]` | A React function component (or a class in the shape `--emit element` writes, back to `.zb`; not any custom element) as a Zubra JSX component next to it (`--as zubra` for the HTML-first file, once nothing is left to finish; `--component` picks one of several exports). Exit 1 and a report for what it can't convert: a spread onto another component, rest props used anywhere but spread onto the returned element, custom hooks, a context from another module, a third-party React primitive in the markup. |
| `zubra request < request.json`, `zubra serve` | The compiler as JSON: one request (or `{ "requests": [...] }`) in, one response out; `serve` keeps answering, one JSON line per request, for a server in any language. |

## Steps for common jobs

**Check a component**: `zubra check src/components/x.zb` (or a folder, for every component under it: `zubra check src`) → read each error's caret line and `help:` → fix → re-run until `no errors`.

**Server HTML for a page in a non-Node server**: start one `zubra serve` per process (the packages in `clients/` keep one behind a lock: Python with Jinja and Django tags, Ruby with Rails helpers, PHP with Laravel's Blade directives; use one of them when the server is in one of those languages). Per render, write one JSON line:

```json
{"command":"compile","emit":"html","path":"/c/price-tag.zb","files":{"/c/price-tag.zb":"<source>"},"props":{"cents":129900},"partial":true}
```

and read one line back: `{"ok":true,"output":"<price-tag …>…</price-tag>","error":null,"warnings":[],"diagnostics":[]}` (`warnings` as rendered strings, `diagnostics` as data). `files` carries every `.zb` the component imports, keyed by the paths the imports resolve to. Serve the browser the `js` output of each component the page used, and `@zubra/runtime`.

**Publish components**: `npx zubra build --lib src/components --out dist && cd dist && npm publish`. Consumers need no Zubra tooling. To test them the way each framework's consumers use them, mount them with `mount(Element, { framework })` from `@zubra/runtime/testing` (`html`, `react`, `vue`; `frameworks()` lists the installed ones) in a browser test runner, as `examples/testing-vitest` does.

**Put components on a WordPress, Shopify or Webflow site**: `npx zubra build --embed src/components --out embed`, then follow `embed/README.md` (host the files, install `embed/wordpress/<name>` as a plugin or `embed/shopify` as a theme app extension, or paste a snippet from `embed/html/`).

**Bring a React component in**: `npx zubra convert src/Thing.jsx`, read the report, finish what it names by hand, then `zubra check` the result.

**Bring a custom element back to `.zb`**: `zubra convert my-element.js --out my-element.zb` reads a class in the shape `--emit element` writes (edited, or written by hand that way) and writes the component. Lines it can't place are reported with `not converted:`.

## Reference

`zubra --help`; https://github.com/zubra-js/zubra/blob/main/docs/reference.md#the-cli, `#sharing-components`, `#moving-in-from-react`; the request format in the repository's `src/request.rs`.
