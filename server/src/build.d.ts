import type { ZubraOptions } from './index.js';

/** An app's own build of the runtime: what `createZubra({ runtime })` takes. Plain data, so it can be kept in a file. */
export interface BuiltRuntime {
  /** The name it is served under, beside the runtime's files: `app-<hash>.js`. */
  file: string;
  /** The module's text. */
  code: string;
  /** Every name it exports. A served module that imports another is refused when it is compiled. */
  names: string[];
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
