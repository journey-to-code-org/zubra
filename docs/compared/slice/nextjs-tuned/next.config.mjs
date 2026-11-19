import { join } from 'node:path';

/**
 * Tuned for production, per Next.js's deploying docs: `output: 'standalone'` traces only the files the
 * server needs into .next/standalone. The shared backend is plain Node code on the kit: load it at
 * run time, don't bundle it. The trace root is the repo, so the shared backend outside this folder
 * is included.
 */
export default {
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '..', '..', '..'),
  serverExternalPackages: ['counter-slice-backend'],
};
