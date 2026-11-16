// `node --import` this to run tests that import `src/` against `dist/production` instead: the
// build an app ships, where private fields have short names (scripts/build-production.js).
import { register } from 'node:module';

register('./resolve.mjs', import.meta.url);
