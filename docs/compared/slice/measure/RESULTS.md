# Slice results

Measured 2026-11-18 on 2 × Intel(R) Xeon(R) Processor @ 2.10GHz, 8 GB, Node v26.13.1, the server pinned to one CPU and the load generator and browsers to the other.
Medians of 3 builds, 5 starts, 3 Lighthouse runs, 3 load runs of 10 s at 50 connections, 12 menu updates and 12 order updates, and 5 slow-device runs.
Raw figures: `results.json`. What each measure means and how it's taken: `measure.mjs`.

## Zubra

| | zubra | zubra-stream |
| --- | ---: | ---: |
| Contract (of 11) | 11 | 11 |
| JavaScript on the menu, gzip (KB) | 16 | 12.5 |
| Script files on the menu | 5 | 4 |
| Menu HTML, gzip (KB) | 1.2 | 1.1 |
| Update shows on the menu, median / p90 (ms) | 9 / 12 | 8 / 8 |
| Update shows on the order page, median / p90 (ms) | 9.5 / 11 | 10.5 / 12 |
| Lighthouse, CPU 6× slower | 90 | 98 |
| Total blocking time, CPU 6× slower (ms) | 399 | 166 |
| Menu load event, CPU 6× slower (ms) | 450 | 438 |
| Add to bag until the notice shows, CPU 6× slower (ms) | 288 | 243 |
| Lines of own code | 180 | 208 |
| Direct dependencies | 5 | 4 |
| Packages installed | 32 | 31 |
| node_modules (MB) | 18 | 18 |
| What runs in production (MB) | 18 | 18 |
| Build (s) | none | none |
| Start to first page (ms) | 239 | 231 |
| Memory idle (MB) | 88 | 88 |
| Memory under load (MB) | 191 | 188 |
| Menu pages per second | 4823 | 4494 |
| Latency p50 / p97.5 (ms) | 9 / 19 | 9 / 22 |
| Failed requests under load | 0 | 0 |
| Accessibility violations (menu, bag) | none | none |

## Web component libraries, each on a plain Node server

| | lit | enhance | stencil | fast | webui |
| --- | ---: | ---: | ---: | ---: | ---: |
| Contract (of 11) | 11 | 11 | 11 | 11 | 11 |
| JavaScript on the menu, gzip (KB) | 8.5 | 5.2 | 10 | 28.5 | 30.7 |
| Script files on the menu | 1 | 1 | 5 | 1 | 1 |
| Menu HTML, gzip (KB) | 1.1 | 0.9 | 1.3 | 1.7 | 2 |
| Update shows on the menu, median / p90 (ms) | 10.5 / 13 | 8 / 9 | 7 / 9 | 7 / 9 | 7 / 10 |
| Update shows on the order page, median / p90 (ms) | 12 / 15 | 10 / 13 | 8.5 / 11 | 10 / 13 | 11 / 15 |
| Lighthouse, CPU 6× slower | 91 | 97 | 99 | 95 | 97 |
| Total blocking time, CPU 6× slower (ms) | 367 | 198 | 127 | 247 | 192 |
| Menu load event, CPU 6× slower (ms) | 363 | 292 | 402 | 397 | 338 |
| Add to bag until the notice shows, CPU 6× slower (ms) | 633 | 544 | 681 | 597 | 595 |
| Lines of own code | 203 | 204 | 299 | 276 | 265 |
| Direct dependencies | 4 | 3 | 1 | 3 | 3 |
| Packages installed | 47 | 40 | 9 | 35 | 35 |
| node_modules (MB) | 30 | 14 | 27 | 44 | 41 |
| What runs in production (MB) | 30 | 1 | 2 | 29 | 29 |
| Build (s) | 0.0 | 0.0 | 5.3 | 0.1 | 0.1 |
| Start to first page (ms) | 221 | 141 | 153 | 108 | 107 |
| Memory idle (MB) | 82 | 75 | 83 | 68 | 68 |
| Memory under load (MB) | 173 | 171 | 227 | 119 | 121 |
| Menu pages per second | 1318 | 2020 | 332 | 3741 | 3806 |
| Latency p50 / p97.5 (ms) | 33 / 65 | 22 / 42 | 134 / 229 | 12 / 23 | 12 / 22 |
| Failed requests under load | 0 | 0 | 0 | 0 | 0 |
| Accessibility violations (menu, bag) | none | none | none | none | none |

## App frameworks (tuned: set up for production by the author, not yet reviewed)

| | sveltekit | nextjs | nextjs-tuned | nuxt | nuxt-tuned |
| --- | ---: | ---: | ---: | ---: | ---: |
| Contract (of 11) | 11 | 10 (fails S8) | 10 (fails S8) | 11 | 11 |
| JavaScript on the menu, gzip (KB) | 38.3 | 132.4 | 132.4 | 73 | 73 |
| Script files on the menu | 12 | 6 | 6 | 3 | 3 |
| Menu HTML, gzip (KB) | 1.5 | 2.2 | 2.2 | 2.1 | 1.6 |
| Update shows on the menu, median / p90 (ms) | 8 / 10 | 8 / 11 | 8.5 / 11 | 8.5 / 11 | 10 / 14 |
| Update shows on the order page, median / p90 (ms) | 9.5 / 12 | 9.5 / 12 | 10 / 12 | 10.5 / 14 | 10 / 14 |
| Lighthouse, CPU 6× slower | 93 | 89 | 89 | 84 | 84 |
| Total blocking time, CPU 6× slower (ms) | 315 | 452 | 445 | 665 | 648 |
| Menu load event, CPU 6× slower (ms) | 388 | 597 | 677 | 382 | 440 |
| Add to bag until the notice shows, CPU 6× slower (ms) | 383 | 552 | 572 | 784 | 806 |
| Lines of own code | 313 | 334 | 339 | 246 | 237 |
| Direct dependencies | 4 | 4 | 4 | 2 | 2 |
| Packages installed | 79 | 55 | 55 | 605 | 605 |
| node_modules (MB) | 76 | 463 | 463 | 228 | 228 |
| What runs in production (MB) | 2 | 494 | 68 | 3 | 3 |
| Build (s) | 2.6 | 11.3 | 12.4 | 8.0 | 7.8 |
| Start to first page (ms) | 144 | 583 | 539 | 312 | 253 |
| Memory idle (MB) | 69 | 106 | 105 | 94 | 86 |
| Memory under load (MB) | 256 | 346 | 345 | 294 | 255 |
| Menu pages per second | 1245 | 364 | 358 | 171 | 400 |
| Latency p50 / p97.5 (ms) | 35 / 76 | 127 / 245 | 132 / 231 | 276 / 408 | 114 / 169 |
| Failed requests under load | 0 | 0 | 0 | 0 | 0 |
| Accessibility violations (menu, bag) | none | none | none | none | none |
