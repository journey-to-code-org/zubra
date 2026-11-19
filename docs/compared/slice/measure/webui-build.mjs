// Builds a WebUI app (templates, then the browser bundle) the way its package.json does, from
// inside the app's folder, so measure.mjs can time it as one step. Flags go to `webui build`.
// Both CLIs are native binaries.
import { execFileSync } from 'node:child_process';

execFileSync('node_modules/@microsoft/webui/bin/webui', ['build', './src', '--out', './dist', ...process.argv.slice(2)], { stdio: 'ignore' });
execFileSync('node_modules/esbuild/bin/esbuild', ['src/index.ts', '--bundle', '--minify', '--format=esm', '--outfile=dist/client.js'], { stdio: 'ignore' });
