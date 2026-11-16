// In development, with the default `cache`, an edit to a component shows on the next request:
// no restart, and no `cache: false`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createZubra } from '../src/index.js';

const layout = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`;
function app(options) {
  const dir = mkdtempSync(join(tmpdir(), 'zubra-dev-edits-'));
  writeFileSync(join(dir, 'click-counter.zb'), '<click-counter start={0}><button>Clicked {start} times</button></click-counter>\n');
  const zubra = createZubra({ components: dir, warn: () => {}, ...options });
  const module = (name) => {
    let served = null;
    const answered = zubra.handle({ url: `/_zubra/components/${name}.js` }, { writeHead: (status, headers) => (served = { status, headers }), end: (body) => (served.body = String(body)) });
    return answered ? served : null;
  };
  return { dir, zubra, module, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

test('development: an edited component is rendered and served as edited, with no restart', async () => {
  const { dir, zubra, module, done } = app({ production: false });
  try {
    assert.match(zubra.page().render('click-counter', { start: 3 }), /Clicked 3 times/);
    assert.match(module('click-counter').body, /Clicked/);
    // The browser is told to ask each time, or it would keep the old module for an hour.
    assert.equal(module('click-counter').headers['cache-control'], 'no-cache');
    await tick();
    writeFileSync(join(dir, 'click-counter.zb'), '<click-counter start={0}><button>Pressed the button {start} times</button></click-counter>\n');
    assert.match(zubra.page().render('click-counter', { start: 3 }), /Pressed the button 3 times/, 'the same render, asked again, is the new one');
    assert.match(module('click-counter').body, /Pressed the button/);
    assert.doesNotMatch(module('click-counter').body, /Clicked/);
  } finally {
    done();
  }
});

test('development: a component added, one in a new folder, and one removed are found without a restart', async () => {
  const { dir, zubra, module, done } = app({ production: false });
  try {
    assert.throws(() => zubra.page().render('new-thing'), /no component "new-thing"/);
    await tick();
    writeFileSync(join(dir, 'new-thing.zb'), '<new-thing><p>New</p></new-thing>\n');
    mkdirSync(join(dir, 'ui'));
    writeFileSync(join(dir, 'ui', 'deep-thing.zb'), '<deep-thing><p>Deep</p></deep-thing>\n');
    assert.match(zubra.page().render('new-thing'), /<p>New<\/p>/);
    assert.match(zubra.page().render('ui/deep-thing'), /<p>Deep<\/p>/);
    assert.equal(module('new-thing').status, 200);
    await tick();
    rmSync(join(dir, 'new-thing.zb'));
    assert.throws(() => zubra.page().render('new-thing'), /no component "new-thing"/);
    assert.match(zubra.page().render('click-counter', { start: 1 }), /Clicked 1 times/, 'the others are as they were');
  } finally {
    done();
  }
});

test('development: a plain module a component imports is served as edited', async () => {
  const { dir, zubra, module, done } = app({ production: false });
  try {
    writeFileSync(join(dir, 'words.js'), "export const word = 'first';\n");
    writeFileSync(join(dir, 'says-word.zb'), "<script>import { word } from './words.js'</script>\n<says-word><p>{word}</p></says-word>\n");
    zubra.page().render('says-word');
    assert.equal(module('says-word').status, 200);
    assert.match(module('words').body, /'first'/);
    await tick();
    writeFileSync(join(dir, 'words.js'), "export const word = 'second one';\n");
    assert.match(module('words').body, /'second one'/);
  } finally {
    done();
  }
});

test('production: what was compiled is kept, and the folder is not read again', async () => {
  const { dir, zubra, module, done } = app({ production: true });
  try {
    assert.match(zubra.page().render('click-counter', { start: 3 }), /Clicked 3 times/);
    assert.equal(module('click-counter').headers['cache-control'], 'public, max-age=3600');
    await tick();
    writeFileSync(join(dir, 'click-counter.zb'), '<click-counter start={0}><button>Pressed the button {start} times</button></click-counter>\n');
    writeFileSync(join(dir, 'new-thing.zb'), '<new-thing><p>New</p></new-thing>\n');
    assert.match(zubra.page().render('click-counter', { start: 3 }), /Clicked 3 times/);
    assert.match(zubra.page().render('click-counter', { start: 4 }), /Clicked 4 times/, 'a render not asked for before, from what was compiled');
    assert.throws(() => zubra.page().render('new-thing'), /no component "new-thing"/);
  } finally {
    done();
  }
});

test('`cache: false` is as it was: every request compiles, in development and production', async () => {
  for (const production of [false, true]) {
    const { dir, zubra, module, done } = app({ production, cache: false });
    try {
      assert.match(zubra.page().render('click-counter', { start: 3 }), /Clicked 3 times/);
      await tick();
      writeFileSync(join(dir, 'click-counter.zb'), '<click-counter start={0}><button>Pressed the button {start} times</button></click-counter>\n');
      assert.match(zubra.page().render('click-counter', { start: 3 }), /Pressed the button 3 times/);
      assert.equal(module('click-counter').headers['cache-control'], 'no-cache');
    } finally {
      done();
    }
  }
});
