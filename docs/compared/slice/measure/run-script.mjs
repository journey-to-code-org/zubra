// Runs one of the app's own npm scripts (from inside its folder) with node, for builds that are more
// than one command. measure.mjs times it as one step.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts[process.argv[2]];
execSync(script, { stdio: 'ignore', env: { ...process.env, PATH: `${process.cwd()}/node_modules/.bin:${process.env.PATH}` } });
