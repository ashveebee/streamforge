import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

const apiTarget = process.env.STREAMFORGE_API ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(process.env.STREAMFORGE_VERSION || pkg.version) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: apiTarget, changeOrigin: false } },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'charts';
          if (id.includes('node_modules/motion') || id.includes('node_modules/framer-motion')) return 'motion';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
        },
      },
    },
  },
});
