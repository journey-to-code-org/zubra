# Compared on one app: an ordering slice built twelve ways

[Compared with Lit and Stencil](compared-with-lit-and-stencil.md) and [Compared with WebUI, FAST, Enhance and WebC](compared-with-html-first.md) compare one component. This page compares one small app: a slice of an ordering app built twelve times, twice in Zubra, in five web component libraries (Lit, Enhance, Stencil, FAST, WebUI) and in three app frameworks (SvelteKit, Next.js, Nuxt, the last two also with a tuned build).

Zubra's author built and measured all twelve, so read it with that in mind. Zubra wins some rows and loses others, and both are below.

## The slice

A menu with live stock counts, a bag, a pickup time, checkout, and an order page that follows the kitchen live. Every page has to work with JavaScript off. Every build runs on the same backend and the same stylesheet, and is measured only once it passes the same eleven browser tests, with JavaScript on and off.

- The web component builds each run on a plain Node server with the library's own server renderer. FAST is rendered by WebUI, as FAST's docs recommend.
- The app frameworks use their documented defaults. Next.js and Nuxt each have a second, tuned build (standalone output; one data call per page). Nobody from those projects has reviewed the tuning.
- Zubra is built twice: with `@zubra/sync` for live updates, and on the same server-sent event stream the others use, so sizes compare like for like.

Each build's code, the spec, the tests, the measuring script and its raw results are in [`compared/slice/`](compared/slice/README.md). The backend they share belongs to a private project and is not published, so the builds can be read but not rerun from this repository; [its interface](compared/slice/shared/README.md) is there.

## What it shows

Zubra 5.23.0, measured 2026-11-18. Medians from one machine with two cores, the server pinned to one. "Slow phone" is Chromium with its CPU slowed six times. The Next.js and Nuxt columns are their default builds; [`RESULTS.md`](compared/slice/measure/RESULTS.md) has every row for all twelve.

| | Zubra (stream) | Zubra (sync) | Lit | Enhance | Stencil | FAST | WebUI | SvelteKit | Next.js | Nuxt |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Tests passed (of 11) | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 11 | 10 | 11 |
| JavaScript on the menu, gzip (KB) | 12.5 | 16 | 8.5 | 5.2 | 10 | 28.5 | 30.7 | 38.3 | 132.4 | 73 |
| Add to bag on a slow phone (ms) | 243 | 288 | 633 | 544 | 681 | 597 | 595 | 383 | 552 | 784 |
| Menu load on a slow phone (ms) | 438 | 450 | 363 | 292 | 402 | 397 | 338 | 388 | 597 | 382 |
| Menu pages served per second | 4,494 | 4,823 | 1,318 | 2,020 | 332 | 3,741 | 3,806 | 1,245 | 364 | 171 |
| Start to first page (ms) | 231 | 239 | 221 | 141 | 153 | 108 | 107 | 144 | 583 | 312 |
| Memory under load (MB) | 188 | 191 | 173 | 171 | 227 | 119 | 121 | 256 | 346 | 294 |
| Lines of the build's own code | 208 | 180 | 203 | 204 | 299 | 276 | 265 | 313 | 334 | 246 |
| Packages installed | 31 | 32 | 47 | 40 | 9 | 35 | 35 | 79 | 55 | 605 |

### Where Zubra is ahead

- **Answering a tap on a slow phone.** Adding an item takes 243 to 288 ms. SvelteKit is next at 383, and the rest take 544 to 806. The Add form names the parts of the page it changes (`data-zb-updates`, from `@zubra/actions`), so its post updates them without reloading the page.
- **Pages served.** About 4,500 to 4,800 menu pages a second on one core, ahead of WebUI and FAST (about 3,700 to 3,800) and well ahead of the rest.
- **Little code.** The sync build is the shortest at 180 lines; the stream build (208) is level with Lit (203) and Enhance (204).

### Where Zubra is behind

- **Download size.** Enhance (5.2 KB), Lit (8.5) and Stencil (10) send less JavaScript than Zubra's 12.5.
- **Menu load.** Enhance (292 ms), WebUI (338) and Lit (363) load the menu sooner than Zubra's 438 to 450.
- **Starting up.** FAST and WebUI serve a first page in about 107 ms and Enhance in 141; Zubra takes about 235.
- **Memory.** FAST and WebUI use about 120 MB under load; Zubra about 190.

### A tie, and a failure

A stock change reaches an open page in 7 to 12 ms (median) in all twelve.

Next.js fails one test: with JavaScript off, its not-found page for an order is empty, and the message appears only when JavaScript draws it.

## What not to conclude

- **One machine, one run.** The same build has differed by up to a third between runs on the same day. Compare builds within this table, not with numbers from elsewhere.
- **Blocking time isn't ranked.** It moved too much between runs of the same build to mean anything, so it isn't in the table above.
- **One author wrote all twelve**, from each project's documentation. A maintainer would likely do better with their own tool. A correction is welcome as an issue or a pull request, and the build will be measured again.
- **It is one small app.** A menu and a checkout say little about a large client-side application, where the app frameworks are at home.
- **It is 5.23.0.** Later work builds an app as one module (`buildApp()`) and compresses what the server sends (`compress`); neither is in these numbers.

## When this points to Zubra, and when it doesn't

For pages rendered on a server that must stay quick on cheap phones, Zubra gave the quickest interaction and the most pages per second here, with about the least code, for a few more kilobytes than the smallest libraries. Where the smallest download matters most, Enhance and Lit are the better choice today.
