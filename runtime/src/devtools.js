// The DevTools reading side: what the browser extension (editors/devtools) shows for a node.
// devhook.js records from the page's start and loads this when the extension connects, so a
// page that never opens the pane doesn't carry it. Neither is in the production build
// (scripts/build-production.js).
//
// The extension reads the page through `globalThis.__ZUBRA_DEVTOOLS__` and nothing else: plain
// JSON out, so the runtime's internals stay free to change. `version` says which shape.
//
// What it knows comes from a `--devtools` build (which @zubra/unplugin makes in Vite's dev
// server): each part's line and column in the `.zb` file, the file itself, and the script's
// signals by name. Without that build, an element still shows its tag, props and bindings,
// unlocated and with fewer names.
//
// The dependencies are read through the engine's `sources()` (signal.js), so the same view works
// on any engine behind it.
import { isNative, engine, changes, sources as introspectSources, sinks as introspectSinks, untrack, isComputed, isState } from './signal.js';
import { children, countLive, effectOf, dev as runtime } from './effect.js';
import { dev as deep, raw } from './deep.js';
import { elements, listeners, hooks, early } from './devhook.js';


// Every component seen since connecting (WeakRefs: the pane keeps no element alive), what each
// prop and named signal is called, and which component each scope is, to name what an update
// wrote and re-ran anywhere on the page.
const records = new Set();
const owned = new WeakMap(); // signal → { record, name }
const scopes = new WeakMap(); // a component's scope → its record

// The most recent flush since connecting (the effects it re-ran, the signals written since the
// one before), and the last TIMELINE of them as the pane shows them, with the effects alive after
// each (a count that only grows is a list or a page keeping what it removed).
const TIMELINE = 50;
const NONE = Symbol('none');
let writes = new Map(); // signal → its value before this update's first write to it (or NONE)
let last = { ran: new Set(), written: new Set() };
let updates = 0;
const timeline = [];
const live = [];
const counts = countLive(); // owners made from now on (before connecting, nothing is counted)

runtime.flushed = (ran, took) => {
  updates++;
  last = { ran: new Set(ran), written: new Set(writes.keys()) };
  timeline.push(entry(updates, ran, took, writes));
  live.push({ update: updates, effects: counts.effects });
  if (timeline.length > TIMELINE) timeline.shift();
  if (live.length > TIMELINE) live.shift();
  writes = new Map();
};
const wrote = (signal, before = NONE) => {
  // A write nothing reads never flushes: don't let those pile up.
  if (writes.size > 1000) writes = new Map();
  if (!writes.has(signal)) writes.set(signal, before);
};
deep.wrote = (signal) => wrote(signal);

/** Watch writes to a signal (a prop's, or a named state's), keeping the value it had. */
function watchWrites(signal) {
  if (signal.__zubraWatched) return;
  const set = signal.set;
  signal.set = function (value) {
    if (!writes.has(signal)) wrote(signal, shown(signal));
    return set.call(this, value);
  };
  Object.defineProperty(signal, '__zubraWatched', { value: true });
}

/** Watch a component's props and named state (once; elements from before connecting too). */
function watch(record) {
  if (record.watched) return;
  record.watched = true;
  records.add(new WeakRef(record));
  if (record.scope) scopes.set(record.scope, record);
  for (const [name, signal] of Object.entries(record.props)) {
    owned.set(signal, { record, name });
    watchWrites(signal);
  }
  for (const [name, signal] of Object.entries(record.named ?? {})) {
    if (!signal || typeof signal !== 'object') continue;
    owned.set(signal, { record, name });
    if (isState(signal) || typeof signal.set === 'function') watchWrites(signal);
  }
}

/** A signal's value as the pane shows it (never throws: a computed may). */
function shown(signal) {
  try { return preview(signal); } catch { return '(threw)'; }
}

/**
 * What a written signal holds now. A property signal of a reactive array or object holds the
 * engine's own counter, so for those it's the property's value (or the whole object's, for its
 * keys).
 */
function nowHolds(signal) {
  const property = deep.propertyOf.get(signal);
  if (!property) return shown(signal);
  const { target, key } = property;
  try { return preview(typeof key === 'symbol' ? target : target[key]); } catch { return '(threw)'; }
}

/** The components seen and on the page now (a removed one's scope is paused, or disposed). */
function* liveRecords() {
  for (const ref of records) {
    const record = ref.deref();
    if (!record) records.delete(ref);
    else if (!record.scope?.disposed && !record.scope?.paused) yield record;
  }
}

/** `<tag> name` for a signal anywhere on the page, or null. `namers` caches one per component. */
function pageName(signal, namers) {
  const own = owned.get(signal);
  if (own) return `<${own.record.tag}> ${own.name}`;
  if (!deep.propertyOf.has(signal)) return null;
  let tried = 0;
  for (const record of liveRecords()) {
    if (++tried > 100) break; // a page of thousands: leave it unnamed rather than walk them all
    let name = namers.get(record);
    if (!name) namers.set(record, (name = namer(record)));
    const found = name(signal);
    if (found) return `<${record.tag}> ${found}`;
  }
  return null;
}

/** The component an effect belongs to (its nearest owner that is a component's scope). */
function componentOf(effect) {
  for (let owner = effect; owner; owner = owner.parent) {
    const record = scopes.get(owner);
    if (record) return record;
  }
  return null;
}

/** An effect as the pane names it: its component, and the binding it is (if it is one). */
function effectName(effect) {
  const tag = componentOf(effect)?.tag;
  const what = effect.label ? `${operation(effect.label.part, effect.label.node)} on ${describe(effect.label.node)}` : 'an effect';
  return tag ? `<${tag}> ${what}` : what;
}

/** One update as the timeline shows it. */
function entry(number, ran, took, written) {
  const namers = new Map();
  return {
    number,
    took: Math.round(took * 100) / 100,
    writes: written.size,
    written: [...written].slice(0, 20).map(([signal, before]) => ({
      name: pageName(signal, namers),
      from: before === NONE ? null : before,
      to: nowHolds(signal),
    })),
    ran: ran.length,
    reran: ran.slice(0, 20).map(effectName),
  };
}
hooks.registered = watch;
for (const ref of early.splice(0)) {
  const record = ref.deref();
  if (record) watch(record);
}

// ---- reading -------------------------------------------------------------------------------

/** The nearest registered component at or above `node`, crossing shadow roots. */
function hostOf(node, skipSelf = false) {
  for (let at = skipSelf ? up(node) : node; at; at = up(at)) if (elements.has(at)) return at;
  return null;
}
const up = (node) => node.parentNode ?? node.host ?? null;

/** Every effect `owner` owns, depth first (a component's own: child components have their own roots). */
function effectsOf(owner, out = []) {
  for (const child of children(owner)) {
    if (child.disposed) continue;
    if (child.computed) out.push(child);
    effectsOf(child, out);
  }
  return out;
}

// Form controls' live state, which the runtime sets as a property (element.js, bindAttribute).
const LIVE = new Set(['input.value', 'textarea.value', 'select.value', 'input.checked', 'option.selected']);

/** The DOM operation a part performs on `node`, in the platform's terms. */
export function operation(part, node) {
  if (part.text) return 'textContent = …';
  if (part.anchor) return 'Text.data = …';
  if (part.global) return `${part.global}.addEventListener('${part.on}', …)`;
  if (part.on) return `addEventListener('${part.on}', …)`;
  if (part.classes) return 'classList.add/remove(…)';
  if (part.toggle) return `classList.toggle('${part.toggle}', …)`;
  if (part.style) return `style.setProperty('${part.style}', …)`;
  if (part.ref) return 'ref(element)';
  if (part.property) return `.${part.property} = …`;
  if (part.attribute) {
    if (node && LIVE.has(`${node.localName}.${part.attribute}`)) return `.${part.attribute} = …`;
    if (part.boolean) return `toggleAttribute('${part.attribute}', …)`;
    if (part.prop) return `.${part.prop} = … (or setAttribute('${part.attribute}', …))`;
    return `setAttribute('${part.attribute}', …)`;
  }
  if (part.when) return 'zb-if: insert or remove a block';
  if (part.each) return 'zb-each: add, move or remove rows';
  if (part.await) return 'zb-await: pending, then or catch';
  if (part.slot) return `slot "${part.slot}"`;
  if (part.spread) return 'spread: attributes and properties';
  return 'binding';
}

/** A short name for a node: `<button.on>`, or its parent's for a text anchor or region marker. */
function describe(node) {
  if (!node) return '?';
  if (node.nodeType === 1) {
    const id = node.id ? `#${node.id}` : '';
    const classes = [...(node.classList ?? [])].slice(0, 2).map((name) => `.${name}`).join('');
    return `<${node.localName}${id}${classes}>`;
  }
  return node.parentNode?.nodeType === 1 ? `${describe(node.parentNode)} content` : node.nodeName;
}

/** A value as a short string: the pane shows values, it doesn't hold them. */
export function preview(value, depth = 0) {
  value = raw(value);
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}…` : value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'function') return `ƒ ${value.name || 'anonymous'}()`;
  if (isComputed(value) || isState(value)) return preview(untrack(() => value.get()), depth);
  if (typeof Node !== 'undefined' && value instanceof Node) return describe(value);
  if (value instanceof Promise) return 'Promise';
  if (Array.isArray(value)) {
    if (depth > 1) return `Array(${value.length})`;
    const shown = value.slice(0, 5).map((item) => preview(item, depth + 1));
    return `[${shown.join(', ')}${value.length > 5 ? `, … ${value.length - 5} more` : ''}]`;
  }
  const name = value.constructor && value.constructor !== Object ? value.constructor.name : '';
  if (depth > 1) return name || '{…}';
  const keys = Object.keys(value);
  const shown = keys.slice(0, 5).map((key) => `${key}: ${preview(value[key], depth + 1)}`);
  return `${name ? `${name} ` : ''}{${shown.join(', ')}${keys.length > 5 ? ', …' : ''}}`;
}

/**
 * Names for the signals a component can read: its props and named script signals, and the
 * property signals of the arrays and objects they hold (`items[0].done`, `items.length`).
 */
function namer(record) {
  const names = new Map();
  for (const [name, signal] of Object.entries(record.props)) names.set(signal, name);
  for (const [name, signal] of Object.entries(record.named ?? {})) if (signal && typeof signal === 'object') names.set(signal, name);
  const paths = new Map(); // raw object → path
  const walk = (value, path, depth) => {
    value = raw(value);
    if (!value || typeof value !== 'object' || paths.has(value) || depth > 3) return;
    paths.set(value, path);
    if (Array.isArray(value)) value.slice(0, 200).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
    else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
      for (const key of Object.keys(value).slice(0, 50)) walk(value[key], `${path}.${key}`, depth + 1);
    }
  };
  for (const [signal, name] of names) {
    try { walk(untrack(() => signal.get()), name, 0); } catch {}
  }
  return (signal) => {
    if (names.has(signal)) return names.get(signal);
    const property = deep.propertyOf.get(signal);
    if (!property) return null;
    const path = paths.get(property.target);
    if (!path) return null;
    const { key } = property;
    if (typeof key === 'symbol') return path; // its keys
    return /^\d+$/.test(key) ? `${path}[${key}]` : `${path}.${key}`;
  };
}

/** The named signals `sink` reads, looking through unnamed computeds to the names behind them. */
function dependencies(sink, name) {
  const found = [];
  const seen = new Set();
  const visit = (node, depth) => {
    let sources;
    try { sources = introspectSources(node); } catch { return; }
    for (const source of sources) {
      if (seen.has(source)) continue;
      seen.add(source);
      const label = name(source);
      if (label) {
        if (!found.includes(label)) found.push(label);
      } else if (isComputed(source) && depth < 6) visit(source, depth + 1);
    }
  };
  visit(sink, 0);
  return found;
}

const location = (part) => (Array.isArray(part?.at) ? { line: part.at[0], column: part.at[1] } : null);

/**
 * Why `sink` re-ran in the last update: each signal it reads that the update wrote, followed
 * through the computeds between (`doubled ← count`: it reads `doubled`, which reads `count`).
 */
function why(sink, name, depth = 0, seen = new Set()) {
  const found = [];
  let sources;
  try { sources = introspectSources(sink); } catch { return found; }
  for (const source of sources) {
    if (seen.has(source)) continue;
    seen.add(source);
    if (last.written.has(source)) found.push(name(source) ?? 'an unnamed signal');
    else if (isComputed(source) && depth < 6) {
      const label = name(source);
      for (const inner of why(source, name, depth + 1, seen)) found.push(label ? `${label} ← ${inner}` : inner);
    }
  }
  return [...new Set(found)];
}

/** One binding as the pane shows it. */
function binding(part, node, effect, name, selected) {
  const ranLast = !!effect && last.ran.has(effect);
  return {
    operation: operation(part, node),
    target: describe(node),
    at: location(part),
    dependsOn: effect ? dependencies(effect.computed, name) : [],
    ranLast,
    because: ranLast ? why(effect.computed, name) : [],
    here: node === selected || (node?.nodeType !== 1 && node?.parentNode === selected),
  };
}

/** What reads `signal` now (only live readers: an effect, or a computed one reads), named. */
function readers(signal, name) {
  let list;
  try { list = introspectSinks(signal); } catch { return []; }
  const out = [];
  for (const sink of list) {
    const effect = effectOf(sink);
    let what;
    if (effect) {
      if (effect.disposed) continue;
      what = effect.label ? `${operation(effect.label.part, effect.label.node)} on ${describe(effect.label.node)}` : 'an effect';
    } else {
      what = name(sink) ?? 'a computed';
    }
    if (!out.includes(what)) out.push(what);
  }
  return out;
}

/**
 * The component's signals as a graph: each prop, state and computed with its value, how many
 * times it has changed (null on an engine that doesn't count), what reads it, and, for a
 * computed, what it reads.
 */
function graph(record, name) {
  const node = (kind, key, signal) => {
    const computed = kind === 'computed';
    let reads = [];
    if (computed) {
      try { reads = dependencies(signal, name); } catch {}
    }
    const readBy = readers(signal, name);
    return { name: key, kind, value: shown(signal), changes: changes(signal), reads, readBy: readBy.slice(0, 12), readers: readBy.length };
  };
  const out = Object.entries(record.props).map(([key, signal]) => node('prop', key, signal));
  for (const [key, signal] of Object.entries(record.named ?? {})) {
    if (isComputed(signal)) out.push(node('computed', key, signal));
    else if (isState(signal)) out.push(node('state', key, signal));
  }
  return out;
}

/** What the pane shows for `node`: its component, and that component's state and bindings. */
export function inspect(node) {
  if (!node) return { version: 1, component: null };
  const host = hostOf(node);
  if (!host) return { version: 1, component: null, native: isNative };
  const record = elements.get(host);
  watch(record);
  const name = namer(record);
  const effects = record.scope ? effectsOf(record.scope) : [];
  const bindings = effects
    .filter((effect) => effect.label)
    .map((effect) => binding(effect.label.part, effect.label.node, effect, name, node));
  // Listeners on the selected node (on the host itself, they're its parent's: see `setBy`).
  if (node !== host) for (const part of listeners.get(node) ?? []) bindings.unshift(binding(part, node, null, name, node));
  // The selected node is itself a component: what its parent binds onto it (its props, its events).
  let setBy = null;
  const parent = node === host ? hostOf(host, true) : null;
  if (parent) {
    const parentRecord = elements.get(parent);
    const parentName = namer(parentRecord);
    const onto = (parentRecord.scope ? effectsOf(parentRecord.scope) : [])
      .filter((effect) => effect.label?.node === host)
      .map((effect) => binding(effect.label.part, host, effect, parentName, host));
    for (const part of listeners.get(host) ?? []) onto.push(binding(part, host, null, parentName, host));
    if (onto.length) setBy = { tag: parentRecord.tag, file: parentRecord.definition.source?.file ?? null, bindings: onto };
  }
  const values = (entries) => entries.map(([key, signal]) => ({ name: key, value: preview(signal) }));
  const written = [...last.written].map(name).filter(Boolean);
  let components = 0;
  for (const _ of liveRecords()) components++;
  return {
    version: 1,
    native: isNative,
    engine,
    update: updates,
    component: {
      tag: record.tag,
      file: record.definition.source?.file ?? null,
      at: location(record.definition.source),
      located: !!record.definition.source,
    },
    props: values(Object.entries(record.props)),
    state: values(Object.entries(record.named ?? {}).filter(([, signal]) => signal && typeof signal === 'object')),
    bindings,
    setBy,
    lastUpdate: {
      number: updates,
      written: [...new Set(written)],
      ran: bindings.filter((item) => item.ranLast).length,
    },
    signals: graph(record, name),
    live: {
      component: effects.length,
      page: counts.effects,
      owners: counts.owners,
      components,
      history: live.slice(),
    },
    timeline: timeline.slice(),
  };
}

/** Open `file` at `line` and `column` in the editor, through Vite's dev server (or the page). */
export function open(file, line = 1, column = 1) {
  // A page can show the place itself (the playground selects the line in its editor): it
  // cancels this event. Otherwise Vite's dev server opens the editor.
  const event = new CustomEvent('zubra:open', { detail: { file, line, column }, cancelable: true });
  if (!globalThis.dispatchEvent(event)) return Promise.resolve(true);
  return fetch(`/__open-in-editor?file=${encodeURIComponent(`${file}:${line}:${column}`)}`).then((response) => response.ok, () => false);
}

// (defineProperties, not Object.assign, which would copy the getter's value once.)
Object.defineProperties(globalThis.__ZUBRA_DEVTOOLS__, {
  ready: { value: true, enumerable: true },
  inspect: { value: inspect, enumerable: true },
  open: { value: open, enumerable: true },
  /** Counts flushes since connecting: the pane re-reads when it changes. */
  updates: { get: () => updates, enumerable: true },
});
