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
  define: {
    // 'android' drops the desktop-only view chunks at build time.
    __MC_TARGET__: JSON.stringify(process.env.MC_TARGET === 'android' ? 'android' : 'desktop'),
  },
  resolve: {
    // Resolve the workspace package to TypeScript source so the client does
    // not need core/dist prebuilt and keeps HMR on shared logic.
    alias: { '@mc/core': path.resolve(__dirname, '../core/src/index.ts') },
  },
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
