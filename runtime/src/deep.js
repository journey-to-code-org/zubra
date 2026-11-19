// Deep reactivity for state: `let items = []` followed by `items.push(x)` updates the DOM.
//
// A `state()` holding an array or a plain object holds a proxy of it instead. Each property the
// template (or a computed) reads through the proxy is tracked by its own `State` (signal.js), created
// on first read, and each write through the proxy bumps that property's signal, so only what
// read the property re-runs. Nested arrays and objects are wrapped lazily, on read. Nothing here
// is a new runtime concept: it's a `State` per property, over the engine's API.
//
// What's wrapped: arrays and plain objects (prototype `Object.prototype` or `null`). Class
// instances, `Map`/`Set`, dates, DOM nodes, functions and promises are left as they are, since a
// proxy would break their internals. `raw(value)` gives the original object back.
// (`plan/decisions/deep-reactivity.md`.)

import { State, tracking } from './signal.js';

const RAW = Symbol('zubra.raw');
const ITERATE = Symbol('zubra.iterate'); // "the set of keys" (ownKeys, `in`, array length)
const ITEMS = Symbol('zubra.items'); // "an array's items": any index, or its length
const proxies = new WeakMap(); // raw → proxy
const signals = new WeakMap(); // raw → Map<key, State<number>>

const isPlain = (value) => {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return true;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** The object behind a reactive proxy, or the value itself. */
export const raw = (value) => (value && typeof value === 'object' && value[RAW]) || value;

// @dev
/**
 * For the DevTools hook (devtools.js), in development only: each property signal's object and
 * key, so it can be named, and `wrote` hears each write through a proxy.
 */
export const dev = { propertyOf: new WeakMap(), wrote: null };
// @dev-end

function track(target, key) {
  // A read nothing is tracking (an event handler, an untracked loop) needs no signal: making one
  // per property read would be most of the cost of a long list.
  if (!tracking()) return;
  let map = signals.get(target);
  if (!map) signals.set(target, (map = new Map()));
  let signal = map.get(key);
  if (!signal) {
    map.set(key, (signal = new State(0)));
    // @dev
    dev.propertyOf.set(signal, { target, key });
    // @dev-end
  }
  signal.get();
}

function trigger(target, key) {
  const signal = signals.get(target)?.get(key);
  if (signal) signal.set(signal.get() + 1);
  // @dev
  if (signal) dev.wrote?.(signal);
  // @dev-end
}

// An array's own mutating methods (`push`, `pop`, `shift`, `unshift`, `splice`) run on the array
// itself and say what changed once: the indexes from the first one they touch, `length` if it
// moved, and the array's items. Through the proxy they went one trap per index they moved, so
// removing one row of a thousand was a thousand `set`s, each with its bookkeeping, and the
// method's own reads of `length` and every index were tracked by whatever effect called it.
// (`sort`, `reverse` and the rest still go through the traps.)
// Each one: the first index it can change on an array of `length` items.
const MUTATORS = {
  push: (args, length) => length,
  pop: (args, length) => length - 1,
  shift: () => 0,
  unshift: () => 0,
  splice: ([start], length) => ((start = Math.trunc(start) || 0) < 0 ? Math.max(0, length + start) : start),
};
const mutator = (target, name) => (...args) => {
  const length = target.length;
  const from = MUTATORS[name](args, length);
  const result = Array.prototype[name].apply(target, args.map(raw));
  // (A tracked key that is an index from `from` on; `'length'` and other names compare as NaN.)
  for (const key of signals.get(target)?.keys() ?? []) if (typeof key === 'string' && key >= from) trigger(target, key);
  if (target.length !== length) {
    trigger(target, 'length');
    trigger(target, ITERATE);
  }
  trigger(target, ITEMS);
  return wrap(result);
};

const handler = {
  get(target, key, receiver) {
    if (key === RAW) return target;
    if (Object.hasOwn(MUTATORS, key) && Array.isArray(target)) return mutator(target, key);
    if (typeof key !== 'symbol') track(target, key);
    return wrap(Reflect.get(target, key, receiver));
  },
  has(target, key) {
    if (typeof key !== 'symbol') track(target, key);
    return Reflect.has(target, key);
  },
  ownKeys(target) {
    track(target, ITERATE);
    return Reflect.ownKeys(target);
  },
  set(target, key, value, receiver) {
    value = raw(value);
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const before = target[key];
    const length = Array.isArray(target) ? target.length : -1;
    const ok = Reflect.set(target, key, value, receiver);
    if (!had) trigger(target, ITERATE);
    const changed = !had || !Object.is(before, value);
    if (changed) trigger(target, key);
    // Setting an index past the end grows the array without a `length` write.
    if (length >= 0 && target.length !== length && key !== 'length') trigger(target, 'length');
    if (length >= 0 && changed && typeof key !== 'symbol') trigger(target, ITEMS);
    return ok;
  },
  deleteProperty(target, key) {
    const had = Object.prototype.hasOwnProperty.call(target, key);
    const ok = Reflect.deleteProperty(target, key);
    if (had) {
      trigger(target, ITERATE);
      trigger(target, key);
      if (Array.isArray(target)) trigger(target, ITEMS);
    }
    return ok;
  },
};

/** `value` as a reactive proxy, if it's an array or a plain object; otherwise `value`. */
export function wrap(value) {
  if (!isPlain(value) || value[RAW]) return value;
  let proxy = proxies.get(value);
  if (!proxy) proxies.set(value, (proxy = new Proxy(value, handler)));
  return proxy;
}

/**
 * Track every item of `list` at once, for a reader that uses them all (`zb-each`): one signal that
 * any index or the length changing bumps, in place of a signal per index.
 */
export function trackItems(list) {
  const target = raw(list);
  if (target !== list) track(target, ITEMS);
}
