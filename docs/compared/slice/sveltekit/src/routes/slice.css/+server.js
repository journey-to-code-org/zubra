import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

/** The shared stylesheet, served unchanged, as every implementation serves it. */
export async function GET() {
  const css = await readFile(createRequire(import.meta.url).resolve('counter-slice-backend/slice.css'), 'utf8');
  return new Response(css, { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600' } });
}
