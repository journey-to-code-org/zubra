# @zubra/compiler

The [Zubra](https://github.com/zubra-js/zubra) compiler built to WebAssembly: `.zb` components in, custom elements, server HTML, typings and framework wrappers out, from Node with no Rust toolchain. Same output and same errors as the native `zubra` CLI. It also installs the `zubra` command.

```sh
npm install --save-dev @zubra/compiler @zubra/runtime
```

Install it at the same version as `@zubra/runtime` (a runtime runs what its own and older compilers wrote, not a later one's).

## On the command line

```sh
npx zubra check src                               # every component under src/: errors and warnings, with fixes
npx zubra compile src/rating.zb --emit js         # the custom element's module
npx zubra add --list                              # the registry's components, to copy into a project
```

[The CLI](https://github.com/zubra-js/zubra/blob/main/docs/reference.md#the-cli) lists every command, flag and exit code.

## From JavaScript

```js
import { compileFile, renderToString } from '@zubra/compiler';

const { ok, output, error } = compileFile('src/rating.zb', { emit: 'js' });
const html = renderToString('src/rating.zb', { props: { value: 3 } });
```

`@zubra/compiler/wasm` is the same compiler for Workers, Deno and browsers, which give it the WebAssembly module themselves. Bundlers use it through [`@zubra/unplugin`](https://www.npmjs.com/package/@zubra/unplugin), and servers through [`@zubra/server`](https://www.npmjs.com/package/@zubra/server).

## More

- [The tutorial](https://zubra-js.github.io/zubra/docs/) and [the reference](https://github.com/zubra-js/zubra/blob/main/docs/reference.md), every rule of the `.zb` format.
- [Editors and tooling without Rust](https://github.com/zubra-js/zubra/blob/main/docs/reference.md#editors-and-tooling-without-rust).
- [Stability](https://github.com/zubra-js/zubra/blob/main/docs/stability.md): what 6.x promises for each entry.

## License

ISC. See `LICENSE`.
