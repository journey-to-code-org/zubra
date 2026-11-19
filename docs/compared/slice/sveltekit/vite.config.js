import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// The shared backend is plain Node code on the kit: load it at run time, don't bundle it.
export default defineConfig({ plugins: [sveltekit({ adapter: adapter() })], ssr: { external: ['counter-slice-backend'] } });
