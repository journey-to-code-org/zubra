# create-zubra

Start an app with [Zubra](https://github.com/zubra-js/zubra) web components.

```sh
npm create zubra@latest                                  # asks for a directory and a framework
npm create zubra@latest my-app -- --framework react      # vanilla, react, vue, svelte, solid, preact, lit, angular, astro
npm create zubra@latest my-app -- --framework vue --typescript
npm create zubra@latest my-app -- --framework server     # a Node server that renders pages, with a form; no bundler
```

The app has a starter page of small components to read and copy from (a counter, a list, a form control, async data, slots), the build plugin set up, typings, a browser test (`npm test`) and an `AGENTS.md` with skills for coding agents. Nothing is installed: the last lines it prints say what to run.

The creator needs Node 20 or newer. Starter toolchains may need a newer Node: Vite starters need Node 20.19+ or 22.12+, Svelte excludes Node 23, Astro needs 22.23.4+, Angular needs Node 22.22.3+ in Node 22, 24.15+ in Node 24, or 26+, and the server starter needs 20.19+. The creator checks the chosen framework and writes its requirement into the app's `package.json`.

## More

- [The starter app](https://github.com/zubra-js/zubra/blob/main/docs/guide/starter-app.md): what each file is, and how to make it yours.
- [The tutorial](https://zubra-js.github.io/zubra/docs/), from a first component to server rendering, forms and local state.

## License

ISC. See `LICENSE`.
