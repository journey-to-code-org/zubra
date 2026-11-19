// Reactivity: Zubra's own engine. `state()` and `computed()` return a `Signal.State` and a
// `Signal.Computed`; `new Signal.State(value)` makes one outside a component.
//
// In signals mode (experimental: `signals: true` in @zubra/unplugin, @zubra/server and
// buildRuntime()), the engine is the TC39 Signals API (https://github.com/tc39/proposal-signals)
// and `Signal` is the proposal's whole API, `Signal.subtle.Watcher` and its introspection
// included; type those from the proposal's own typings (`signal-polyfill`) where you use them.

export declare namespace Signal {
  interface Options<T> {
    /** When two values count as the same (no change): `Object.is` by default. */
    equals?: (this: AnySignal<T>, a: T, b: T) => boolean;
  }

  type AnySignal<T = any> = State<T> | Computed<T>;

  class State<T> {
    constructor(initialValue: T, options?: Options<T>);
    get(): T;
    set(value: T): void;
  }

  class Computed<T> {
    constructor(computation: (this: Computed<T>) => T, options?: Options<T>);
    get(): T;
  }

  namespace subtle {
    /** Run `fn` without tracking what it reads. */
    function untrack<T>(fn: () => T): T;
    /** The computed being computed now, if any. */
    function currentComputed(): Computed<any> | undefined;
  }
}

/** True when the runtime uses the browser's native `Signal`: only ever in signals mode. */
export declare const isNative: boolean;
