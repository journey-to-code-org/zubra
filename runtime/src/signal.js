// The reactive engine: the one module the rest of the runtime (and compiled code, through it)
// gets reactivity from.
//
// Everything else (effects, deep state, components, context, resources, Sync) talks to the
// engine only through what this file exports, so the engine behind it can change without
// anything else changing. Today there is one engine: the TC39 Signals API, the platform's
// `Signal` when it has one, Zubra's implementation (signal-impl.js) otherwise.
// (`plan/decisions/reactive-engine.md` in the project.)
//
// The contract:
//
//   State, Computed          classes: `new State(value, { equals })`, `.get()`, `.set(value)`;
//                            `new Computed(fn, { equals })`, `.get()`. Lazy, cached, glitch-free,
//                            with the equality cut-off. Author code holds these.
//   isState(v), isComputed(v), isSignal(v)
//   untrack(fn)              run fn without tracking what it reads
//   tracking()               whether a read now would be tracked (something is computing)
//   reactions(notify)        what effect.js builds effects on (below)
//   sources(v)               a computed's dependencies, for the DevTools (development only)
//   sinks(v)                 what is subscribed to a signal (for tests: nothing leaks)
//   Signal, isNative         the public `Signal` export of @zubra/runtime
//
// A reaction is a computation the engine re-validates on request: `create(fn)` makes one,
// `watch(r)` / `unwatch(...r)` start and stop telling `notify` (once per batch) that a watched
// reaction may need to run, `pending()` lists the ones that do (and re-arms `notify`), and
// `run(r)` re-runs `fn` if, and only if, something it read changed since its last run.
import { Signal as Implementation } from './signal-impl.js';

export const Signal = globalThis.Signal ?? Implementation;
export const isNative = Signal !== Implementation;
export const { State, Computed } = Signal;
export const { untrack } = Signal.subtle;
const { currentComputed, introspectSources, introspectSinks, Watcher } = Signal.subtle;

export const isState = (value) => value instanceof State;
export const isComputed = (value) => value instanceof Computed;
export const isSignal = (value) => value instanceof State || value instanceof Computed;
export const tracking = () => currentComputed() !== undefined;
export const sources = (value) => introspectSources(value);
export const sinks = (value) => introspectSinks(value);

/** Reactions on one Watcher, flushed by the caller (the proposal's own pattern for effects). */
export function reactions(notify) {
  const watcher = new Watcher(notify);
  return {
    create: (fn) => new Computed(fn),
    run: (reaction) => untrack(() => reaction.get()),
    watch: (reaction) => watcher.watch(reaction),
    unwatch: (...list) => watcher.unwatch(...list),
    pending() {
      const pending = watcher.getPending();
      watcher.watch(); // re-arm before running, so writes made by effects schedule another round
      return pending;
    },
  };
}
