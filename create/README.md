# create-zubra

Start an app with [Zubra](https://github.com/zubra-js/zubra) web components.

```sh
npm create zubra@latest                                  # asks for a directory and a framework
npm create zubra@latest my-app -- --framework react      # vanilla, react, vue, svelte, solid, preact, lit, angular, astro
npm create zubra@latest my-app -- --framework vue --typescript
npm create zubra@latest my-app -- --framework server     # a Node server that renders pages, with a form; no bundler
```

The app has a starter page of small components to read and copy from (a counter, a list, a form control, async data, slots), the build plugin set up, typings, a browser test (`npm test`) and an `AGENTS.md` with skills for coding agents. Nothing is installed: the last lines it prints say what to run.

## More

- [The starter app](https://github.com/zubra-js/zubra/blob/main/docs/guide/starter-app.md): what each file is, and how to make it yours.
- [The tutorial](https://zubra-js.github.io/zubra/docs/), from a first component to server rendering, forms and local state.

## License

ISC. See `LICENSE`.
