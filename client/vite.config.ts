import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function developmentApiToken(): string {
  try {
    const root = process.env.JIRAWEB_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JiraWeb');
    return fs.readFileSync(path.join(root, 'api-token'), 'utf8').trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Long-cacheable vendor chunk (react barely changes between builds).
        manualChunks(id) {
          return /node_modules[\\/]react(?:-dom)?[\\/]/.test(id) ? 'vendor' : undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5643',
        changeOrigin: false,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.startsWith('/api/bootstrap') && !req.headers['x-mc-token']) {
              const token = developmentApiToken();
              if (token) proxyReq.setHeader('x-mc-token', token);
            }
          });
        },
      },
    },
  },
});
