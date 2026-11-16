// What editors/vscode/scripts/package.mjs checks the .vsix's dependencies against: the committed
// lockfiles. Its own module, so the check is tested without packaging anything.
import { readFileSync } from 'node:fs';

const nameOf = (path, entry) => entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);

/** name@version → integrity, from a committed lockfile's runtime packages. */
export function locked(file) {
  const known = new Map();
  for (const [path, entry] of Object.entries(JSON.parse(readFileSync(file, 'utf8')).packages ?? {})) {
    if (!path.includes('node_modules/') || entry.dev || entry.link) continue;
    const name = nameOf(path, entry);
    known.set(`${name}@${entry.version}`, entry.integrity ?? null);
  }
  return known;
}

/**
 * Every package the install put in `work`, as its lockfile records it, is one the committed
 * lockfiles have, with the same hash; the language server is the version being released.
 */
export function checkInstalled(installed, known, server) {
  const strangers = [];
  for (const [path, entry] of Object.entries(installed.packages ?? {})) {
    if (!path.includes('node_modules/')) continue;
    const name = nameOf(path, entry);
    if (name === '@zubra/language-server') {
      if (entry.version !== server) strangers.push(`${name}@${entry.version} (expected ${server})`);
      continue;
    }
    const key = `${name}@${entry.version}`;
    if (!known.has(key)) strangers.push(`${key} (no committed lockfile has this version)`);
    else if (known.get(key) && entry.integrity !== known.get(key)) strangers.push(`${key} (its hash differs from the committed lockfile's)`);
  }
  if (strangers.length) throw new Error(`vscode: the package would carry dependencies the committed lockfiles don't: ${strangers.join('; ')}. Update editors/vscode or editors/language-server's package-lock.json, review the change, and release again.`);
}
