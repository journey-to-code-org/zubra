# Performance

Zubra's own size budgets and benchmarks run in CI (`runtime/test/tools/size.test.js` and `runtime/test/browser/bench.test.js`). They say whether Zubra got slower than itself. This page is about how it compares with others, measured in ways other people use.

## js-framework-benchmark

[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) is the benchmark most frameworks are compared on. It defines one app, a table of rows and six buttons, and times nine operations on it. Zubra's implementation is in [`benchmarks/js-framework-benchmark/frameworks/keyed/zubra`](../benchmarks/js-framework-benchmark/frameworks/keyed/zubra), in the benchmark's own layout. It is one `.zb` file written the way the guide teaches:

- `let rows`, mutated in place (`rows[i].label += ' !!!'`, `rows.splice(…)`);
- a keyed `zb-each`;
- `onclick` on each link, not one delegated handler.

**Status: ready to submit, not yet submitted.** Until it's merged upstream and appears in the official results, there are no official numbers. The official runner reads Chrome's traces, throttles the CPU for some operations, and repeats each many times on a quiet machine. Its results are the ones to quote, and this page will link them.

**Checked in CI.** `benchmarks/js-framework-benchmark/run.mjs` runs the nine operations with the benchmark's own selectors and checks: the warmups, then the measured step and its check. It fails if any check fails or the page logs an error (the `benchmark` job). The job builds the implementation twice: from the published packages (`npm run build`, as the benchmark's repository would, pinned to the latest release), and from the checkout (`npm run build:checkout`, this repository's runtime and plugin with the compiler `$ZUBRA_COMPILER` names), so a change that breaks the benchmark fails when it's made.

### Measured locally, not the official method

Two scripts, both on one machine in one run; neither is the benchmark's score.

`node run.mjs --time --compare <checkout> vanillajs lit solid` times each operation from the click to the frame after it, with `requestAnimationFrame`: Chromium without throttling, median of nine runs. Layout and paint are most of each operation, so these move 10 to 20% between runs. `main` (unreleased 6.0: Zubra's own reactive engine, minified components, faster removals), measured 2026-11-19, beside the benchmark's hand-written JavaScript (`vanillajs`), Lit 3 and Solid:

| Operation | Zubra | vanilla JS | Lit | Solid |
|---|---|---|---|---|
| create rows | 90.3 | 67.1 | 89.5 | 68.9 |
| replace all rows | 86.3 | 70.3 | 79.3 | 67.0 |
| partial update | 14.5 | 20.7 | 13.6 | 14.0 |
| select row | 10.3 | 10.3 | 8.6 | 11.4 |
| swap rows | 14.2 | 12.7 | 13.9 | 13.8 |
| remove row | 20.8 | 17.7 | 19.4 | 18.0 |
| create many rows | 934.1 | 689.2 | 829.3 | 742.1 |
| append rows to large table | 101.1 | 73.4 | 73.1 | 81.2 |
| clear rows | 12.0 | 8.7 | 9.0 | 6.5 |

`node profile.mjs --compare <checkout> vanillajs lit solid` measures script time instead: a CPU profile over cycles of clicks, without layout, paint and garbage collection, interleaved over rounds so the machine's drift falls on every implementation alike. It is the steadier measure, and the one to use before and after a change to the runtime. Same day, median of three rounds of eight cycles:

| Cycle (script ms) | Zubra | vanilla JS | Lit | Solid |
|---|---:|---:|---:|---:|
| create 1,000 rows, clear | 26.6 | 10.8 | 21.1 | 13.4 |
| create 1,000 rows twice, clear | 48.1 | 23.3 | 43.9 | 27.5 |
| create 1,000, append 1,000, clear | 54.8 | 26.6 | 45.3 | 30.4 |
| create 1,000, update ×10, clear | 33.9 | 17.5 | 28.6 | 20.1 |
| create 1,000, select ×10, clear | 33.5 | 17.3 | 27.9 | 15.7 |
| create 1,000, swap ×10, clear | 39.2 | 17.2 | 27.6 | 21.7 |
| create 1,000, remove ×10, clear | 32.8 | 17.6 | 24.2 | 17.9 |
| garbage collection, create and clear | 6.9 | 1.8 | 5.6 | 3.4 |

Milliseconds; lower is better. What they say:

- **Updates, selection, swaps and removals are level with the others** on the clock. (In 5.7.0 a swap of rows 2 and 999 moved every row in between, 61 ms; the keyed pass now keeps the longest run in order and moves two.)
- **Making rows costs about twice the hand-written script time**, and 10 to 30% more than Lit: creating, replacing and appending. Each row has its own effect per binding, a list of parts with their paths, and a proxy with a signal per property it reads, and its garbage shows. Compiling the paths in, one effect per row and shared event listeners are the work that's left.

When the official results exist, they replace these tables.

## The Signals core

**Since 6.0** the default engine is Zubra's own (`runtime/src/signal.js`), and the TC39 API is signals mode (experimental). Against the API on the same effects, in Node (median of 30): creating and disposing 2,000 effects 6.6 ms to 1.5 ms, selecting one row of 1,000 0.54 ms to 0.47 ms, updating 1,000 states in one flush 0.35 ms to 0.30 ms; the engine is 1,685 B compressed against 2,716 B, and what every page loads fell from 16.1 KB to 15.1 KB. An effect there is one node the graph marks directly; on the API it is a Computed and a Watcher's links to it. This section is about 5.x, and about signals mode now.

In 5.x, compiled components got their reactivity from `runtime/src/signal-impl.js`, Zubra's implementation of the TC39 Signals API (the native `Signal` replaced it where a browser had one); in 6.0 that is signals mode, and the default is the engine above. Profiling the benchmark's create and clear found most of the runtime's own time, and most of its garbage collection, in that file and in `effect.js`. Three things cost it, all fixed without changing the API:

- **A `WeakMap` from each signal to its internal node.** A `WeakMap` with tens of thousands of keys is a table the garbage collector walks on every collection. Each signal now holds its node in a private field, which is also the check that a method was called on the right kind of object.
- **`Watcher.getPending()` looked at every watched signal.** Zubra's effects shared one Watcher (in signals mode, still do) and called `getPending()` on each flush, the pattern the proposal's README shows, so every update cost something for every effect on the page. The Watcher now records computeds as they're marked dirty: O(pending), not O(watched). The one visible difference is the order, listed in `runtime/README.md`.
- **Allocation:** five arrays per node made up front, and a `Set` of children per effect, though most have none. Both are now made on first use.

Measured in Node (median ms, each case in a fresh process), against the polyfill and the two fastest signals libraries, which have their own APIs:

| Case | Before | After | signal-polyfill | alien-signals 3 | Preact signals |
|---|---|---|---|---|---|
| create and dispose 2,000 effects | 14–20 | 3.2–4.3 | 12–20 | 0.14–0.24 | 0.24–0.39 |
| 1 write, 1,000 watching effects, 2 re-run | 0.44–0.78 | 0.12–0.13 | 0.39–0.60 | 0.03 | 0.03 |
| 1 state → 1,000 computeds → effects | 0.6–0.85 | 0.28–0.43 | 0.48–0.54 | 0.05–0.06 | 0.06–0.09 |

The rest of the gap to alien-signals was the API's shape: an effect on the proposal is a `Computed` plus a Watcher entry, about ten objects, where alien-signals' is two. That gap is why 6.0's default engine is Zubra's own, with no Watcher (above). A WebAssembly core was tried too and isn't a way round it: a call into WebAssembly costs about twice a JavaScript call, and a signals core is nothing but small calls.

In the benchmark, with `run.mjs --time --runs 9` (same machine, same run, before and after this change; differences under about 15% are noise on this machine):

| Operation | vanilla JS | Before | After |
|---|---|---|---|
| create rows | 85.5 | 137.1 | 99.5 |
| replace all rows | 66.3 | 148.8 | 126.8 |
| select row | 9.3 | 15.5 | 5.7 |
| create many rows | 794.2 | 1,437.2 | 1,332.5 |
| append rows to large table | 91.6 | 140.7 | 123.3 |
| clear rows | 9.0 | 23.7 | 16.9 |

What's left in creating and clearing rows is mostly the DOM work each row does: two comment markers and a fragment, `importNode`, `textContent`, and an effect per binding.

### Rows

A row `zb-each` makes in the browser is now its block's own nodes, with no comment markers and no fragment of its own; rows the server rendered keep their markers, so hydration is unchanged. A block with no custom elements is copied into the document once and each row clones that copy (a block with one still uses `importNode`, so its elements upgrade before their props are bound). A text binding on an element holding one Text node compares and writes that node's `.data`. Same run, before and after:

| Operation | vanilla JS | Solid | Before | After |
|---|---|---|---|---|
| create rows | 82.3 | 72.2 | 105.1 | 112.3 |
| replace all rows | 82.4 | 67.0 | 125.4 | 110.4 |
| create many rows | 734.9 | 821.7 | 1,260.3 | 1,198.5 |
| append rows to large table | 84.6 | 95.1 | 151.7 | 114.0 |
| clear rows | 8.5 | 6.8 | 24.4 | 16.7 |

Create rows and remove row moved within this machine's noise (about 15%). A CPU profile of creating and clearing 1,000 rows, which is steadier, puts the DOM calls Zubra makes at 20–24 ms a cycle, from 28. Its JavaScript didn't move (22–26 ms, against about 7 for hand-written JS): that's an effect per binding and finding each binding's node by its path at runtime, the next piece of work.

## Server rendering

The comparison with WebUI, FAST, Enhance and WebC (`docs/compared-with-html-first.md`) measures server rendering against those four. The short version: on a page of ten components, WebUI's server is about 15 times faster. Since 5.9.0 Zubra parses a component once, but each component on a page is still its own request to the compiler, with about 30 µs of fixed cost in WebAssembly.
