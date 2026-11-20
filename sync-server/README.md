# zubra-sync

The log that `'use collection'` devices share, as one binary: the same HTTP protocol as `@zubra/sync/server`, the same SQLite table as `sqliteLog()`, and no Node.js. For servers in Python, Go, PHP or anything else, or a small box of its own.

```sh
cargo build --release -p zubra-sync
./target/release/zubra-sync --db sync.db --port 4000 --open
```

| Option | |
|---|---|
| `--db <file>` | the SQLite log (default `sync.db`); the same file `sqliteLog()` reads and writes |
| `--host`, `--port` | where to listen (default `127.0.0.1:4000`; `--port 0` picks a free one and prints it) |
| `--origin <url>` | an origin whose pages may use it directly, with CORS; repeatable |
| `--keep-alive <ms>` | how often a quiet live stream gets a keep-alive comment (default 15000) |
| `--read <collection>` | let pages read this collection (repeatable). Without it, `--read-all` or `--open`, pages read nothing |
| `--read-all` | let pages read every collection, and still write nothing |
| `--open` | take reads and writes (push, presence, signal) from pages. Without it, writes are refused with a 403 |

It has no notion of users or permissions, so pages read nothing until it's told which collections they may (`--read`, `--read-all`), and write nothing until it's started with `--open`; `--open` also opens reads for every collection. It says so at start. Then put it behind your app at `/_zb/sync` (a reverse proxy, after the app's own sign-in), which also makes it same-origin for the pages, or run it on a network you trust. Pages then `connect()` as usual.

Its tests are `@zubra/sync`'s: `npm test` in `sync/` runs the protocol tests against both servers when the binary is built, and `npm run test:binary` runs the browser tests with the binary behind a proxy.
