import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** The shared stylesheet, served unchanged, as every implementation serves it. */
export default defineEventHandler(async (event) => {
  setResponseHeaders(event, { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600' });
  return readFile(createRequire(import.meta.url).resolve('counter-slice-backend/slice.css'), 'utf8');
});
