// Which Solid an app uses, for its typings. plugin/src/solid.js is the same function (the plugin
// has no dependencies, so it can't import this one); change both together.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Which Solid an app at `root` uses: `solid2` when the installed solid-js (in `root`'s
 * node_modules or a folder's above it, as a workspace hoists it) is 2 or later, else when its
 * package.json asks for 2 (`^2.0.0`, `2.0.0-rc.22`); `solid` otherwise. Solid 2 keeps JSX in
 * `@solidjs/web/jsx-runtime` and compiles `on:valuechange` to a listener for ":valuechange", so
 * its typings differ (`--framework solid2`).
 */
export function solidOf(root) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    try {
      const { version } = JSON.parse(readFileSync(join(dir, 'node_modules', 'solid-js', 'package.json'), 'utf8'));
      return Number.parseInt(version, 10) >= 2 ? 'solid2' : 'solid';
    } catch { /* not installed here: look further up */ }
    if (dirname(dir) === dir) break;
  }
  let manifest = {};
  try { manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')); } catch { /* none */ }
  const range = { ...manifest.peerDependencies, ...manifest.devDependencies, ...manifest.dependencies }['solid-js'] ?? '';
  const major = /\d+/.exec(range);
  return major && Number(major[0]) >= 2 ? 'solid2' : 'solid';
}
