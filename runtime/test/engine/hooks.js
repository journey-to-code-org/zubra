// Resolves the runtime's engine (src/signal.js) to signals mode's (src/signal-tc39.js) when
// ZUBRA_ENGINE=signals, so a suite runs on either:
// `ZUBRA_ENGINE=signals node --import ./test/engine/register.js --test …`. This checkout's
// runtime, and a package's installed copy of it (Sync installs the runtime as a copy), when that
// copy has the engine.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const engine = process.env.ZUBRA_ENGINE;
export async function resolve(specifier, context, next) {
  const resolved = await next(specifier, context);
  if (engine === 'signals' && /\/runtime\/src\/signal\.js$/.test(resolved.url)) {
    const url = resolved.url.replace(/signal\.js$/, 'signal-tc39.js');
    if (existsSync(fileURLToPath(url))) return { ...resolved, url };
    throw new Error(`ZUBRA_ENGINE=signals, but ${fileURLToPath(url)} isn't there (reinstall the package's copy of the runtime)`);
  }
  return resolved;
}
