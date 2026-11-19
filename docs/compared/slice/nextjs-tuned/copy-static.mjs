// Standalone output leaves out the browser files; Next.js's docs say to copy them in beside the server.
import { cpSync } from 'node:fs';

cpSync('.next/static', '.next/standalone/compare/slice/nextjs-tuned/.next/static', { recursive: true });
