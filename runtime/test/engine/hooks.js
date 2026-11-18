// Resolves the runtime's engine (src/signal.js) to the one ZUBRA_ENGINE names, so a suite runs
// on either: `ZUBRA_ENGINE=core node --import ./test/engine/register.js --test …`. This checkout's
// runtime, and a package's installed copy of it (Sync installs the runtime as a copy), when that
// copy has the engine.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const engine = process.env.ZUBRA_ENGINE;
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  if (engine === 'core' && /\/runtime\/src\/signal\.js$/.test(resolved.url)) {
    const url = resolved.url.replace(/signal\.js$/, 'signal-core.js');
    if (existsSync(fileURLToPath(url))) return { ...resolved, url };
    throw new Error(`ZUBRA_ENGINE=core, but ${fileURLToPath(url)} isn't there (reinstall the package's copy of the runtime)`);
  }
  return resolved;
}
