import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Build → ui/dist/, which the zero-dep Node server (server/index.cjs) serves in production.
// In dev, `vite` runs its own dev server and proxies /api to the running cockpit server
// (start it separately with `npm run server`, default port 4729).
export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 4730,
    proxy: { '/api': 'http://127.0.0.1:4729' },
  },
});
