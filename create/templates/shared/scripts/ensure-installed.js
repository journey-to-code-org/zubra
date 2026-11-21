// `npm run dev` before `npm install` asks the shell for `vite` or `astro`, or starts the
// server, which then can't import its packages. Git Bash reports "command not found",
// which reads as if the app never included them. npm runs this first (`predev`,
// `pretest`, …) and stops when it fails, so the message is the one that says what to run.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, 'node_modules'))) process.exit(0);

const script = (process.env.npm_lifecycle_event ?? '').replace(/^pre/, '');
const again = script === 'test' ? 'npm test' : script === 'start' ? 'npm start' : script ? `npm run ${script}` : '';
console.error(`Dependencies are not installed. Run npm install${again ? `, then ${again}` : ''}.`);
process.exit(1);
