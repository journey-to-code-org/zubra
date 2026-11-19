// Typings for @zubra/unplugin. The option docs match the README's "Options".
import type { UnpluginInstance } from 'unplugin';

export interface ZubraOptions {
  /** The compiler CLI to run. Default: `$ZUBRA_COMPILER`, then `@zubra/compiler` (WebAssembly), then `zubra` on PATH. */
  compiler?: string;
  /** What a `.zb` import gives plain `.js`/`.ts` files. Default: `'auto'` (detected from the React or Vue Vite plugin). */
  framework?: 'auto' | 'react' | 'vue' | 'element';
  /**
   * Write typings (`x.d.zb.ts`) next to each component. Default: `true`. `{ dir }` writes them
   * under that folder of the app instead (with a `tsconfig.json` there to extend), for
   * components that apps in different frameworks share.
   */
  dts?: boolean | { dir: string };
  /** The runtime module compiled code imports. Default: `'@zubra/runtime'`. */
  runtime?: string;
  /** Server builds register a renderer, which needs `@zubra/compiler` at run time. Default: `true`. */
  ssr?: boolean;
  /**
   * `false` for an app whose pages are never rendered on a server (no SSR, no prerendering, no
   * Zubra server): components are compiled without what takes over server markup, and the
   * runtime's hydration code (about 0.3 KB gzip) stays out of the bundle. An element then renders
   * fresh over whatever children it starts with, as the page's own. Default: `true`.
   */
  hydrate?: boolean;
  /** The module server builds render with. Default: `'@zubra/compiler'`. */
  compilerModule?: string;
  /** Compile for the Zubra DevTools in builds too, not only in Vite's dev server. Default: `$ZUBRA_DEVTOOLS === '1'`. */
  devtools?: boolean;
  /**
   * Signals mode (experimental): the runtime's reactivity on the TC39 Signals API in place of
   * Zubra's own engine. `state()` then returns a real `Signal.State`, the runtime's `Signal` export
   * is the proposal's whole API (`Signal.subtle.Watcher` and its introspection), and a browser's
   * native `Signal` is used when it has one. For interoperating with other Signals libraries and
   * tools. Default: `false`.
   */
  signals?: boolean;
  /**
   * Where the app's own components are, to find which of a package's components it has its own
   * copy of (the app's stands in for the package's). Default: Vite's root, or the current folder.
   */
  root?: string;
}

export declare const unplugin: UnpluginInstance<ZubraOptions | undefined, false>;

/** The variant a `.zb` import gives: by explicit query, by the importer's kind, or the project's. */
export declare function variantFor(query: string, importer: string | undefined, project: string | null): 'element' | 'react' | 'vue';

/** Whether a `.zb` component renders into light DOM (no `shadow` on its host tag). */
export declare function isLightDom(source: string): boolean;

export default unplugin;
