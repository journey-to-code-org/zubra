// The installed @zubra/compiler and @zubra/runtime, and what to say when they don't go together.
import { readFileSync } from 'node:fs';

/** A package's version, from the `package.json` at `url`; null if it can't be read. */
export const versionAt = (url) => {
  try {
    return JSON.parse(readFileSync(url, 'utf8')).version ?? null;
  } catch {
    return null;
  }
};
/** `a` is a later release than `b` (`x.y.z`; a prerelease counts as its release). */
const later = (a, b) => {
  const [x, y] = [a, b].map((version) => String(version).split('-')[0].split('.').map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
/**
 * What to say when the installed `@zubra/compiler` is a later release than `@zubra/runtime`, or
 * null. A module is compiled for its compiler's runtime: a later compiler may write an import of
 * a runtime entry the installed runtime doesn't have (5.19's `@zubra/runtime/hydrate` on 5.18),
 * and then no module of the page loads. The page still shows its server HTML, so nothing looks
 * wrong on the server; only the browser's console says `Failed to resolve module specifier`. npm
 * allows the pair (the peer ranges are `^`), and gets there when an app pins the runtime and the
 * server but not the compiler. An older compiler is fine: the runtime runs what it wrote.
 */
export function versionSkew(compilerVersion, runtimeVersion) {
  if (!compilerVersion || !runtimeVersion || !later(compilerVersion, runtimeVersion)) return null;
  return `@zubra/server: @zubra/compiler is ${compilerVersion} and @zubra/runtime is ${runtimeVersion}. Components are compiled for the compiler's own release, so a module may import what this older runtime doesn't have; then no element starts, and the only sign is the browser's "Failed to resolve module specifier". Install one version of both: npm install @zubra/runtime@${compilerVersion} @zubra/server@${compilerVersion} (or, to stay on the older release, npm install @zubra/compiler@${runtimeVersion}).`;
}
