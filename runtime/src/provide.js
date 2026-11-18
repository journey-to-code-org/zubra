// Context (the Web Components Community Group Context Protocol): `createContext`, `provide`,
// `inject` and the protocol's two events. A page whose components use none doesn't load this.
//
// A consumer dispatches a bubbling, composed `context-request` event carrying the context key
// and a callback; the nearest provider for that key stops it and calls back with the value,
// and with `subscribe: true` keeps calling back when the value changes, passing an
// `unsubscribe` function. Providers announce themselves with a `context-provider` event, so a
// consumer that asked before its provider existed can ask again. Because it is plain DOM events,
// zubra components share context with any other implementation (Lit's @lit/context, …).
import { State, Computed } from './signal.js';
import { $r, hooks, onMount, watch } from './element.js';

export class ContextRequestEvent extends Event {
  constructor(context, contextTarget, callback, subscribe) {
    super('context-request', { bubbles: true, composed: true });
    this.context = context;
    this.contextTarget = contextTarget;
    this.callback = callback;
    this.subscribe = subscribe;
  }
}

export class ContextProviderEvent extends Event {
  constructor(context, contextTarget) {
    super('context-provider', { bubbles: true, composed: true });
    this.context = context;
    this.contextTarget = contextTarget;
  }
}

/** A context key, with the value consumers get when no provider answers. */
export function createContext(defaultValue) {
  return Object.freeze({ defaultValue });
}

/**
 * Provide `value` (a plain value or a signal) for `context` to every element inside this one.
 * Must be called during setup.
 */
export function provide(context, value) {
  const host = hooks('provide').host;
  const subscribers = new Set();
  host.addEventListener('context-request', (event) => {
    if (event.context !== context || event.contextTarget === host) return;
    event.stopPropagation();
    if (!event.subscribe) return event.callback($r(value));
    const subscriber = { callback: event.callback };
    subscriber.unsubscribe = () => subscribers.delete(subscriber);
    subscribers.add(subscriber);
    event.callback($r(value), subscriber.unsubscribe);
  });
  watch(() => $r(value), (next) => {
    for (const subscriber of [...subscribers]) subscriber.callback(next, subscriber.unsubscribe);
  });
  host.dispatchEvent(new ContextProviderEvent(context, host));
}

/**
 * Read `context` from the nearest provider above this element, as a signal that follows the
 * provider's value. Must be called during setup. Without a provider the value is `fallback`
 * (by default the context's own default). Works with any Context Protocol provider: pass its
 * key as `context`.
 */
export function inject(context, fallback = context?.defaultValue) {
  const component = hooks('inject');
  const host = component.host;
  // The value the server rendered with (`data-zb-inject`, by call number) is where it starts,
  // so hydrating doesn't show the default until the provider answers.
  const number = (component.injects = (component.injects ?? 0) + 1);
  const rendered = host.getAttribute('data-zb-inject');
  if (rendered) {
    try {
      const values = JSON.parse(rendered);
      if (Object.hasOwn(values, number)) fallback = values[number];
    } catch { /* not ours: keep the default */ }
  }
  const value = new State(fallback);
  let unsubscribe = null;
  let answered = false;
  let generation = 0;
  const request = () => {
    const mine = ++generation;
    answered = false;
    host.dispatchEvent(new ContextRequestEvent(context, host, (next, stop) => {
      if (mine !== generation) return stop?.();  // an answer to a request we've moved past
      answered = true;
      if (stop) unsubscribe = stop;
      value.set(next);
    }, true));
  };
  const lateProvider = (event) => {
    if (!answered && event.context === context && event.contextTarget !== host) request();
  };
  // Ask now, so the first render already has the value; ask again whenever the element is
  // re-attached (it may have moved under a different provider).
  let firstMount = true;
  request();
  onMount(() => {
    if (!firstMount) request();
    firstMount = false;
    document.addEventListener('context-provider', lateProvider);
    return () => {
      document.removeEventListener('context-provider', lateProvider);
      generation++;
      unsubscribe?.();
      unsubscribe = null;
    };
  });
  return new Computed(() => value.get());
}
