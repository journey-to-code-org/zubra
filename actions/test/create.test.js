// `npm create zubra -- --framework server`: the app is written here (so it resolves this
// package's own dependencies: @zubra/server, the compiler, the runtime, Playwright), then its
// own test runs: the server starts, and the page is used with JavaScript and without.
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCompiler } from '@zubra/server';
import { create } from '../../create/index.js';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');

test("the server starter's own test passes, in JavaScript and with --typescript", () => {
  findCompiler();
  for (const typescript of [false, true]) {
    const dir = join(here, '.tmp-create', typescript ? 'server-ts' : 'server');
    rmSync(dir, { recursive: true, force: true });
    create(dir, 'server', { name: 'server starter', typescript });
    // What `npm install` would give it: this package under its name, and its dependencies.
    mkdirSync(join(dir, 'node_modules', '@zubra'), { recursive: true });
    symlinkSync(here, join(dir, 'node_modules', '@zubra', 'actions'), 'junction');
    for (const name of ['@zubra/server', '@zubra/compiler', '@zubra/runtime', 'playwright']) symlinkSync(join(here, 'node_modules', name), join(dir, 'node_modules', name), 'junction');
    try {
      execFileSync(process.execPath, ['--test', 'test/app.test.js'], { cwd: dir, stdio: 'pipe', encoding: 'utf8', env: { ...process.env, NODE_ENV: '' } });
    } catch (error) {
      throw new Error(`the server starter's test failed:\n${error.stdout}${error.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
