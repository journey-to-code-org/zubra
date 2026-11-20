# @zubra/language-server

The language server for [Zubra](https://github.com/zubra-js/zubra)'s `.zb` components: diagnostics as you type, completion, hover, go to definition, formatting and an extract-component refactor. It also has a TypeScript plugin that gives `.ts` files the types of the components they import. The VS Code extension ([on the Marketplace](https://marketplace.visualstudio.com/items?itemName=JourneytoCode.zubra)) runs it for you; this package is for every other editor.

```sh
npm install --save-dev @zubra/language-server @zubra/compiler
```

## Run it

```sh
npx zubra-language-server --stdio
```

Point Neovim, Helix, Zed, Sublime LSP or any editor that speaks LSP at that command, for `.zb` files. It uses the compiler named in `initializationOptions.compiler` if there is one, otherwise the project's `@zubra/compiler`, then `$ZUBRA_COMPILER`, then `zubra` on the `PATH`.

For `.ts` files, add the TypeScript plugin to `tsconfig.json`:

```json
{ "compilerOptions": { "plugins": [{ "name": "@zubra/language-server/typescript-plugin" }] } }
```

## More

- [Editor support](https://github.com/zubra-js/zubra/blob/main/docs/editor-support.md): VS Code, other editors, the TypeScript plugin and the DevTools.
- [The reference](https://github.com/zubra-js/zubra/blob/main/docs/reference.md), every rule the diagnostics check.

## License

ISC. See `LICENSE`.
