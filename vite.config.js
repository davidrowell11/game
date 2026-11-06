import { defineConfig } from 'vite';

// base './' so the built game loads from file:// inside Electron.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
