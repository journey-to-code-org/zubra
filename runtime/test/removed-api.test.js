// 5.x's TC39 API that the default engine doesn't have: in development each name says so (and where
// to go), instead of "not a constructor", `undefined`, or a callback that silently never runs. The
// production build leaves that out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Signal, State, Computed } from '../src/signal.js';
import { Signal as ProductionSignal } from '../dist/production/signal.js';

// (test/tools/production.test.js runs these files again with src/ resolved to dist/production,
// where the development-only names aren't: there the production test below is what applies.)
const development = !import.meta.resolve('../src/signal.js').includes('/dist/production/');
const POINTER = /TC39 Signals API.*engine: 'signals'.*docs\/migrating-to-6\.0\.md/;

test('in development, Watcher, watched, unwatched and the introspection functions throw and point to signals mode', { skip: !development }, () => {
  assert.throws(() => new Signal.subtle.Watcher(() => {}), (error) => error instanceof TypeError && /Signal\.subtle\.Watcher is TC39/.test(error.message) && POINTER.test(error.message));
  assert.throws(() => ({ [Signal.subtle.watched]() {} }), /Signal\.subtle\.watched is TC39/);
  assert.throws(() => ({ [Signal.subtle.unwatched]() {} }), /Signal\.subtle\.unwatched is TC39/);
  assert.throws(() => Signal.subtle.introspectSources?.(new Computed(() => 1)), /Signal\.subtle\.introspectSources is TC39/);
  for (const name of ['introspectSinks', 'hasSinks', 'hasSources']) assert.throws(() => Signal.subtle[name], new RegExp(`Signal\\.subtle\\.${name} is TC39`));
  // What 6.0 keeps still works, and the export is still frozen.
  assert.equal(Signal.subtle.untrack(() => new Signal.State(2).get()), 2);
  assert.equal(Signal.subtle.currentComputed(), undefined);
  assert.ok(Object.isFrozen(Signal.subtle));
});

test('in production, those names are undefined, as documented', () => {
  for (const name of ['Watcher', 'watched', 'unwatched', 'introspectSources', 'introspectSinks', 'hasSinks', 'hasSources']) {
    assert.equal(ProductionSignal.subtle[name], undefined, name);
  }
  assert.equal(typeof ProductionSignal.subtle.untrack, 'function');
});

test('a watched or unwatched option key warns once, as its callback never runs', { skip: !development }, (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => { warnings.push(message); });
  new State(0, { equals: Object.is });
  new Computed(() => 1);
  assert.equal(warnings.length, 0);
  new State(0, { watched() {} });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /`watched` option, whose callback never runs/);
  assert.match(warnings[0], POINTER);
  // Once: neither another one nor a Computed's says it again.
  new State(0, { unwatched() {} });
  new Computed(() => 1, { [Symbol('watched')]() {} });
  assert.equal(warnings.length, 1);
});

test("a Computed's options are checked too", { skip: !development }, async (t) => {
  const fresh = await import('../src/signal.js?computed'); // its own once
  const warnings = [];
  t.mock.method(console, 'warn', (message) => { warnings.push(message); });
  new fresh.Computed(() => 1, { [Symbol('unwatched')]() {} });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /`unwatched` option/);
});
