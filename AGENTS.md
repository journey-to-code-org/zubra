# Working in this repository

Zubra is a compiler for web components: `.zb` files in, custom elements, server HTML, typings and framework wrappers out. The Rust compiler is in `src/`, the browser runtime in `runtime/`, the npm packages in `compiler/`, `plugin/`, `server/`, `create/`, `editors/` and the siblings `actions/`, `sync/` and `router/`, the Sync log as a Rust binary in `sync-server/`, `include_zb!` in `macros/`, the Python, Ruby and PHP packages in `clients/`, the Prettier plugin (not on npm yet) in `prettier-plugin/`, the component registry in `registry/`, and a tested app per framework and server in `examples/`. `docs/stability.md` says what each promises in 6.x, and `docs/migrating-to-6.0.md` how to move from 5.x.

## Skills

Read the skill before the task, not the source: each is written so an agent can do the job from it alone.

| Task | Skill |
|---|---|
| Write or change a component | `skills/zubra-component/SKILL.md` |
| Use a component from React, Vue, Svelte, Solid, Angular, Lit, Astro or plain HTML | `skills/zubra-consume/SKILL.md` |
| Run the compiler: check, compile, publish a library, add a registry component, convert React, serve | `skills/zubra-cli/SKILL.md` |
| Render on a server, or make a meta-framework page complete before JavaScript | `skills/zubra-server/SKILL.md` |

`npm create zubra` copies the first two into new projects, beside an `AGENTS.md` of their own (`create/templates/shared/AGENTS.md`, and `create/templates/server/AGENTS.md` for the server-rendered app, which also gets the fourth: keep them in step with the example components there; `create/test/create.test.js` checks each names every one), and `zubra build --lib` writes a consuming skill for the library it builds, so apps that use Zubra carry their own.

## Changing the compiler or runtime

- Build: `cargo build --release`. `@zubra/compiler` runs its WebAssembly build (`zubra.wasm`, made by `npm run build` in `compiler/` with the `wasm32-unknown-unknown` target); without it, it runs the native CLI named by `$ZUBRA_COMPILER` (`export ZUBRA_COMPILER=$PWD/target/release/zubra`), and nothing else. `@zubra/server` also looks for a checkout's `target/{debug,release}/zubra` and sets `ZUBRA_COMPILER` to it, the language server uses the checkout's build only with `ZUBRA_DEV_CHECKOUT=1`, and `@zubra/unplugin` falls back to `zubra` on the `PATH`.
- Tests: `cargo test` (compiler), `cd runtime && npm test && npm run test:browser` (needs Playwright's Chromium), `cd plugin && npm test`, `cd compiler && npm test`, `node skills/test/skills.test.js`. `.github/workflows/ci.yml` runs every suite.
- Every behaviour is mutation-checked: when adding one, break it on purpose once and confirm a test fails.
- Commits are authored by Mikey Nichols with no trailers. Versions are bumped with `scripts/bump-version.sh`, and each release gets a `CHANGELOG.md` entry. Merging the bump to `main` releases it (`.github/workflows/release.yml`: npm with provenance, the tag, the GitHub release); don't tag or publish by hand. A prerelease (`scripts/bump-version.sh 6.0.0-rc.0`) goes to npm under `next` and leaves the editor extensions on the last release.
- The plans and decision records live in the project's docs (`plan/`), not in the repository; `docs/reference.md` is the reference for what the compiler does.
