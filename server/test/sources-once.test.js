// A component's sources go to the compiler once: it keeps them under a handle, and the requests
// after that name the handle (plan: roadmap-footprint F3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZubra } from '../src/index.js';
import { createCore } from '../src/core.js';

const components = join(dirname(fileURLToPath(import.meta.url)), 'components');

/** A core over a stand-in compiler that keeps loaded files as the real one does. */
function over(compiler, options = {}) {
  const asked = [];
  const core = createCore({
    request: (body) => {
      asked.push(body);
      return compiler(body);
    },
    files: new Map([['x-card', '/c/x-card.zb'], ['y-card', '/c/y-card.zb']]),
    sourcesOf: (path) => ({ [path]: `<${path.slice(3, -3)}></${path.slice(3, -3)}>` }),
    base: '/_zubra',
    warn: () => {},
    ...options,
  });
  return { core, asked, loads: () => asked.filter((body) => body.command === 'load').length, withFiles: () => asked.filter((body) => body.command !== 'load' && body.files).length, byHandle: () => asked.filter((body) => body.loaded !== undefined).length };
}
const answer = (files, body) => ({ ok: true, output: `<x>${Object.keys(files).join()} ${JSON.stringify(body.props ?? null)}</x>` });
/** Keeps what it is given to load, until `forget()`. */
function keeping() {
  const sets = new Map();
  const compiler = (body) => {
    if (body.command === 'load') {
      const handle = `h${JSON.stringify(body.files).length}-${Object.keys(body.files).join()}`;
      sets.set(handle, body.files);
      return { ok: true, output: handle };
    }
    if (body.loaded !== undefined) {
      assert.equal(body.files, undefined, 'a request has the handle or the files');
      return sets.has(body.loaded) ? answer(sets.get(body.loaded), body) : { ok: false, error: 'load again', reload: true };
    }
    return answer(body.files, body);
  };
  return { compiler, forget: () => sets.clear() };
}

test("a component's sources are loaded once, and every request after names the handle", () => {
  const { compiler } = keeping();
  const { core, asked, loads, withFiles, byHandle } = over(compiler);
  assert.equal(core.render('x-card', { n: 1 }), '<x>/c/x-card.zb {"n":1}</x>');
  assert.deepEqual(asked.map((body) => body.command ?? body.emit), ['load', 'html']);
  core.render('x-card', { n: 2 });
  core.render('x-card', { n: 3 });
  assert.deepEqual([loads(), byHandle(), withFiles()], [1, 3, 0], 'one load, then only the handle');
  // Another component is another set; the first component's other requests use its handle.
  core.render('y-card', { n: 1 });
  core.module('x-card');
  assert.deepEqual([loads(), byHandle(), withFiles()], [2, 5, 0]);
});

test('a compiler that has lost a handle is sent the files again, and the answer is the same', () => {
  const { compiler, forget } = keeping();
  const { core, loads, withFiles } = over(compiler);
  core.render('x-card', { n: 1 });
  forget(); // a new instance after a crash, or the set let go to make room
  assert.equal(core.render('x-card', { n: 2 }), '<x>/c/x-card.zb {"n":2}</x>');
  core.render('x-card', { n: 3 });
  assert.deepEqual([loads(), withFiles()], [2, 0], 'loaded once more, and from the handle after');
});

test('a compiler that keeps nothing (a process per request) gets the files with every request, after one try', () => {
  const forgetful = (body) => (body.command === 'load' ? { ok: true, output: 'h' } : body.loaded !== undefined ? { ok: false, error: 'load again', reload: true } : answer(body.files, body));
  const { core, asked, loads, withFiles } = over(forgetful);
  assert.equal(core.render('x-card', { n: 1 }), '<x>/c/x-card.zb {"n":1}</x>');
  const tried = asked.length;
  assert.equal(loads(), 2, 'loaded, told to reload, loaded again, told again');
  core.render('x-card', { n: 2 });
  core.render('y-card', { n: 1 });
  assert.equal(asked.length, tried + 2, 'one request each from here on');
  assert.deepEqual([loads(), withFiles()], [2, 3]);
});

test("a compiler that doesn't know `load` (an older one) gets the files, and its refusal isn't the page's error", () => {
  const older = (body) => (body.command === 'load' ? { ok: false, output: null, error: '`path` is required' } : answer(body.files, body));
  const { core, loads, withFiles, byHandle } = over(older);
  assert.equal(core.render('x-card', { n: 1 }), '<x>/c/x-card.zb {"n":1}</x>');
  core.render('x-card', { n: 2 });
  assert.deepEqual([loads(), byHandle(), withFiles()], [1, 0, 2]);
});

test('without the cache, sources are read for every request and sent with it', () => {
  const { compiler } = keeping();
  const { core, loads, withFiles } = over(compiler, { cache: false });
  core.render('x-card', { n: 1 });
  core.render('x-card', { n: 2 });
  assert.deepEqual([loads(), withFiles()], [0, 2]);
});

test("an error from a loaded set is the component's error, as before", () => {
  const { compiler } = keeping();
  const failing = (body) => (body.loaded !== undefined ? { ok: false, error: 'error: unknown prop `x`' } : compiler(body));
  const { core } = over(failing);
  assert.throws(() => core.render('x-card', { x: 1 }), /unknown prop `x`/);
});

test('with the real compiler, a page is the same whether its sources were loaded or sent each time', () => {
  const pageOf = (options) => {
    const zubra = createZubra({ components, production: true, ...options });
    const page = zubra.page();
    const parts = [page.render('order-form', {}), page.render('count-stepper', { value: 2 }), page.render('count-stepper', { value: 5 }), page.render('hello-there', { name: 'Ada', items: [{ id: 1, text: 'one' }] })];
    return page.finish(`<html><head></head><body>${parts.join('')}</body></html>`);
  };
  assert.equal(pageOf({}), pageOf({ cache: false }));
});
