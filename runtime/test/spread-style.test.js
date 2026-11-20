import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spread } from '../src/spread.js';
import { State } from '../src/signal.js';
import { root, flush } from '../src/effect.js';

test('a spread omits unsafe style values and removes a previously safe one', () => {
  const styles = new Map();
  const node = {
    localName: 'a',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    style: {
      getPropertyValue: (key) => styles.get(key) ?? '',
      setProperty: (key, value) => styles.set(key, value),
      removeProperty: (key) => styles.delete(key),
    },
    getAttribute: () => null,
    removeAttribute: () => {},
  };
  const values = new State({ style: { color: 'blue' } });
  const errors = [];
  const before = console.error;
  console.error = (...args) => errors.push(args);
  const scope = root(() => spread({ spread: () => values.get() }, node));
  try {
    assert.equal(styles.get('color'), 'blue');
    values.set({ style: { color: 'red;}', background: 'url(https://evil.test)', width: { x: 1 }, fontSize: '2px' } });
    flush();
    assert.deepEqual([...styles], [['font-size', '2px']]);
    assert.equal(errors.length, 3);
  } finally {
    scope.dispose();
    console.error = before;
  }
});
