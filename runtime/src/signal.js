// The reactive engine: the one module the rest of the runtime (and compiled code, through it)
// gets reactivity from. Zubra's own, and the default since 6.0.
//
// Everything else (effects, deep state, components, context, resources, Sync) talks to the
// engine only through what this file exports, so the engine behind it can change without
// anything else changing. signal-tc39.js is the other engine, the experimental signals mode, on
// the TC39 Signals API; a build or a server that opts into it serves that file as this one.
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
//
// The model is the TC39 proposal's: state, computeds and effects; dependencies tracked as they
// are read; computeds lazy, cached and glitch-free, with the equality cut-off; a write marks what
// depends on it, and only effects that are watched hear about it. What it leaves out is what the
// proposal's API needs and the runtime doesn't:
//
//   - No Watcher. An effect's computation is a node of its own kind, a reaction, which the graph
//     marks directly: one node per effect, where the API's way is a Computed (an object and its
//     node) plus a Watcher's links to it. Watching and unwatching a reaction costs its own
//     dependencies, not a scan of everything the Watcher watches.
//   - No introspection beyond `sources()` and `sinks()`, no `watched`/`unwatched` hooks, no
//     frozen notification phase (the only notify is effect.js's, which schedules a microtask).
//   - Nothing is adopted from `globalThis`: this file decides how every Zubra app updates, and a
//     browser shipping `Signal` changes nothing until an app opts into signals mode.
//
// Bookkeeping follows signal-impl.js, which the differential tests hold to `signal-polyfill`:
// positional dependencies with back-indices for O(1) unlinking, version numbers per signal and a
// global epoch, and back-links only for what something live (a watched reaction) depends on, so
// an unwatched graph keeps no references and costs nothing on write.
const UNSET = Symbol('unset');
const COMPUTING = Symbol('computing');
const ERRORED = Symbol('errored');

const STATE = 0, COMPUTED = 1, REACTION = 2;

let active = null;
let epoch = 0;
let stamps = 0;

class Node {
  constructor(kind, wrapper) {
    this.kind = kind;
    this.wrapper = wrapper;
    this.version = 0;
    this.dirty = false;
    this.value = undefined;
    this.error = undefined;
    this.equals = Object.is;
    this.computation = null;
    this.lastCleanEpoch = -1;
    // Live consumers, two entries each: the consumer, and where this node is in its `deps`
    // (lazy). One array, not two, made only when needed: most nodes have one or two.
    this.sinks = null;
    // Dependencies (consumers only, lazy), three entries each: the source, the version of it
    // last seen, and where this node is in the source's `sinks` (0 when not live).
    this.deps = null;
    this.nextSource = 0;        // in dependencies, not entries
    this.group = null;          // reactions only: whose `notify` hears it
    this.live = false;          // reactions only: watched
    this.seen = 0;              // reactions only: de-duplication stamp for pending()
  }
}

const isLive = (node) => (node.kind === REACTION ? node.live : node.sinks !== null && node.sinks.length > 0);

// Most nodes have one to three dependencies and sinks. `push` on a short array leaves room for
// about 20 entries; a copy at the exact length is cheaper to keep alive. Past SMALL entries, push.
const SMALL = 12;
/** Subscribe `consumer` to `producer`, as its dependency number `slotInConsumer`; returns where it went in `producer.sinks` (counted in sinks, not entries). */
function link(producer, consumer, slotInConsumer) {
  const sinks = producer.sinks;
  if (sinks === null || sinks.length === 0) {
    // Becoming live: what it depends on now needs its back-link too.
    const deps = producer.deps;
    if (deps !== null) for (let j = 0; j < deps.length; j += 3) deps[j + 2] = link(deps[j], producer, j / 3);
    if (sinks === null) {
      producer.sinks = [consumer, slotInConsumer];
      return 0;
    }
  }
  const index = sinks.length >> 1;
  if (sinks.length < SMALL) producer.sinks = [...sinks, consumer, slotInConsumer];
  else sinks.push(consumer, slotInConsumer);
  return index;
}

/** Remove sink number `slot` from `producer.sinks`, moving the last one into its place. */
function unlink(producer, slot) {
  const sinks = producer.sinks;
  if (sinks.length === 2) {
    const deps = producer.deps;
    if (deps !== null) for (let j = 0; j < deps.length; j += 3) unlink(deps[j], deps[j + 2]);
  }
  const last = sinks.length - 2;
  const at = slot * 2;
  if (at < last) {
    const moved = sinks[last];
    const movedSlot = sinks[last + 1];
    sinks[at] = moved;
    sinks[at + 1] = movedSlot;
    moved.deps[movedSlot * 3 + 2] = slot;
  }
  sinks.pop();
  sinks.pop();
}

function track(producer) {
  const consumer = active;
  if (consumer === null) return;
  const n = consumer.nextSource++;
  const deps = consumer.deps;
  const j = n * 3;
  if (deps === null || j === deps.length) {
    // A new dependency, appended (the three entries in order, so the array has no holes).
    const slot = isLive(consumer) ? link(producer, consumer, n) : 0;
    if (deps === null) consumer.deps = [producer, producer.version, slot];
    else if (deps.length < SMALL) consumer.deps = [...deps, producer, producer.version, slot];
    else deps.push(producer, producer.version, slot);
    return;
  }
  if (deps[j] !== producer) {
    const live = isLive(consumer);
    if (live) unlink(deps[j], deps[j + 2]);
    deps[j] = producer;
    deps[j + 2] = live ? link(producer, consumer, n) : 0;
  }
  deps[j + 1] = producer.version;
}

function trimSources(consumer) {
  const deps = consumer.deps;
  if (deps === null) return;
  const count = consumer.nextSource * 3;
  if (count === deps.length) return;
  if (isLive(consumer)) for (let j = count; j < deps.length; j += 3) unlink(deps[j], deps[j + 2]);
  deps.length = count;
}

function markSinks(producer) {
  const sinks = producer.sinks;
  if (sinks === null) return;
  for (let i = 0; i < sinks.length; i += 2) {
    const consumer = sinks[i];
    if (consumer.dirty) continue;
    consumer.dirty = true;
    if (consumer.kind === REACTION) consumer.group.mark(consumer);
    else markSinks(consumer);
  }
}

function refresh(node) {
  if (node.kind === STATE) return;
  if (!node.dirty && node.lastCleanEpoch === epoch) return;
  if (node.value === UNSET || node.value === COMPUTING || sourcesChanged(node)) recompute(node);
  node.dirty = false;
  node.lastCleanEpoch = epoch;
}

function sourcesChanged(node) {
  const deps = node.deps;
  if (deps === null) return false;
  for (let j = 0; j < deps.length; j += 3) {
    const source = deps[j];
    const seen = deps[j + 1];
    if (source.version !== seen) return true;
    refresh(source);
    if (source.version !== seen) return true;
  }
  return false;
}

function recompute(node) {
  if (node.value === COMPUTING) throw new Error('zubra: a computed reads itself (a cycle)');
  const previousValue = node.value;
  node.value = COMPUTING;
  node.nextSource = 0;
  const previousActive = active;
  active = node;
  let value;
  let equal = false;
  try {
    value = node.computation.call(node.wrapper);
    equal = node.kind === COMPUTED && previousValue !== UNSET && previousValue !== ERRORED
      && node.equals.call(node.wrapper, previousValue, value);
  } catch (error) {
    value = ERRORED;
    node.error = error;
  } finally {
    active = previousActive;
    trimSources(node);
  }
  if (equal) { node.value = previousValue; return; }
  node.value = value;
  node.version++;
}

// ---- the contract (above) ------------------------------------------------------------------

let stateNode, computedNode;

export class State {
  #node;
  constructor(initialValue, options) {
    const node = new Node(STATE, this);
    node.value = initialValue;
    if (options?.equals) node.equals = options.equals;
    this.#node = node;
  }
  static { stateNode = (x) => (#node in x ? x.#node : undefined); }

  get() {
    const node = this.#node;
    track(node);
    return node.value;
  }

  set(value) {
    const node = this.#node;
    if (node.equals.call(this, node.value, value)) return;
    node.value = value;
    node.version++;
    epoch++;
    markSinks(node);
  }
}

export class Computed {
  #node;
  constructor(computation, options) {
    if (typeof computation !== 'function') throw new TypeError('zubra: computed() takes a function');
    const node = new Node(COMPUTED, this);
    node.computation = computation;
    node.value = UNSET;
    node.dirty = true;
    if (options?.equals) node.equals = options.equals;
    this.#node = node;
  }
  static { computedNode = (x) => (#node in x ? x.#node : undefined); }

  get() {
    const node = this.#node;
    refresh(node);
    track(node);
    if (node.value === ERRORED) throw node.error;
    return node.value;
  }
}

const isObject = (value) => value !== null && typeof value === 'object';
export const isState = (value) => isObject(value) && stateNode(value) !== undefined;
export const isComputed = (value) => isObject(value) && computedNode(value) !== undefined;
export const isSignal = (value) => isObject(value) && (stateNode(value) ?? computedNode(value)) !== undefined;

export function untrack(fn) {
  const previous = active;
  active = null;
  try { return fn(); } finally { active = previous; }
}

export const tracking = () => active !== null;

/** Reactions, each told to `notify` (once until `pending()` is next read) when it may need to run. */
export function reactions(notify) {
  let marked = [];
  let armed = true;
  const group = {
    mark(node) {
      marked.push(node);
      if (armed) { armed = false; notify(); }
    },
  };
  return {
    /** A reaction that calls `fn` with `this` as `owner` (an effect, which `owner()` gives back). */
    create(fn, owner) {
      const node = new Node(REACTION, owner);
      node.computation = fn;
      node.value = UNSET;
      node.dirty = true;
      node.group = group;
      return node;
    },
    owner: (node) => node.wrapper,
    run(node) {
      const previous = active;
      active = null;
      try { refresh(node); } finally { active = previous; }
      if (node.value === ERRORED) throw node.error;
    },
    watch(node) {
      if (node.live) return;
      node.live = true;
      const deps = node.deps;
      if (deps !== null) for (let j = 0; j < deps.length; j += 3) deps[j + 2] = link(deps[j], node, j / 3);
      // A dirty reaction isn't listed: whoever watches one runs it next (effect.js, on creating
      // and on resuming an effect), and a list entry nothing flushes would keep it alive.
    },
    unwatch(...nodes) {
      for (const node of nodes) {
        if (!node.live) continue;
        node.live = false;
        const deps = node.deps;
        if (deps !== null) for (let j = 0; j < deps.length; j += 3) unlink(deps[j], deps[j + 2]);
      }
    },
    pending() {
      const list = marked;
      marked = [];
      armed = true;
      const out = [];
      const stamp = ++stamps;
      for (const node of list) {
        if (!node.dirty || !node.live || node.seen === stamp) continue;
        node.seen = stamp; // listed once (a number: a list here would keep every node in it alive)
        out.push(node);
      }
      return out;
    },
  };
}

/** What a computed or an effect's reaction read last, for the DevTools. */
export function sources(value) {
  const node = value instanceof Node ? value : isObject(value) ? computedNode(value) : undefined;
  if (!node) throw new TypeError('zubra: sources() takes a computed or an effect');
  const deps = node.deps ?? [];
  const out = [];
  for (let j = 0; j < deps.length; j += 3) out.push(deps[j].wrapper);
  return out;
}

/** What is subscribed to a state or a computed (only what is live: a watched effect, or what it reads). */
export function sinks(value) {
  const node = isObject(value) ? (stateNode(value) ?? computedNode(value)) : undefined;
  if (!node) throw new TypeError('zubra: sinks() takes a state or a computed');
  const sinks = node.sinks ?? [];
  const out = [];
  for (let i = 0; i < sinks.length; i += 2) out.push(sinks[i].wrapper ?? sinks[i]);
  return out;
}

// The public `Signal` export: enough of the old shape that `new Signal.State(0)` and
// `Signal.subtle.untrack(fn)` keep working. It is not the TC39 API (no Watcher, no
// introspection): that is signals mode (signal-tc39.js).
export const Signal = Object.freeze({
  State,
  Computed,
  subtle: Object.freeze({ untrack, currentComputed: () => (active !== null && active.kind === COMPUTED ? active.wrapper : undefined) }),
});
export const isNative = false;
