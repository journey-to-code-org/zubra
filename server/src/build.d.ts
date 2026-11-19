import type { ZubraOptions } from './index.js';

/** An app's own build of the runtime: what `createZubra({ runtime })` takes. Plain data, so it can be kept in a file. */
export interface BuiltRuntime {
  /** The name it is served under, beside the runtime's files: `app-<hash>.js`. */
  file: string;
  /** The module's text. */
  code: string;
  /** Every name it exports. A served module that imports another is refused when it is compiled. */
  names: string[];
  /** Built with `signals: true` (signals mode): only a server with the same option takes it. */
  signals?: true;
}

export interface BuildRuntimeOptions extends Omit<ZubraOptions, 'runtime'> {
  /** More names of the script API to include, for a `<script type="module">` of your own that imports `@zubra/runtime`. */
  keep?: string[];
  /** The esbuild module, if it isn't installed where `@zubra/server` or the app can find it. */
  esbuild?: unknown;
}

/**
 * Experimental. Build the runtime for one app: every name its components, the plain modules
 * beside them and `@zubra/sync` import from the runtime, and only what those reach, as one
 * module. Needs esbuild, which the app installs (`@zubra/server` doesn't depend on it). Pass the
 * options you pass `createZubra`, and the result as its `runtime`.
 */
export declare function buildRuntime(options?: BuildRuntimeOptions): Promise<BuiltRuntime>;

/** The app's one module: a built runtime that also holds the components and the page scripts named. */
export interface BuiltApp extends BuiltRuntime {
  /** The components it defines. One it doesn't hold is refused when its page is made. */
  components: string[];
  /** Whether it has page scripts of the app's own (then every page loads it, components or not). */
  scripts: boolean;
  /** With `@zubra/sync` in the module (a component or a script uses it): what the package's store module exports. Its own address then answers from this module, so there is one copy of the store. */
  sync?: string[];
}

export interface BuildAppOptions extends BuildRuntimeOptions {
  /** Paths of browser modules of your own to include, run for their effects: a page's live-update script, `@zubra/actions`' form script. What they import from `@zubra/runtime` is the components' copy. */
  scripts?: string[];
}

/**
 * Experimental. Build one module for the whole app: the runtime as `buildRuntime()` makes it,
 * every component, the plain modules they import, and `scripts`. With it as
 * `createZubra({ runtime })`, a page's only script is that module, where it loaded the runtime,
 * each component and each script of its own. Every page loads the same one, so it is cached
 * once; it defines every component of the app, on the page or not.
 */
export declare function buildApp(options?: BuildAppOptions): Promise<BuiltApp>;
