import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000, sourcemap: false },
  optimizeDeps: { exclude: ['@dimforge/rapier3d-compat'] },
});
