import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Long-cacheable vendor chunk (react barely changes between builds).
        manualChunks: { vendor: ['react', 'react-dom'] },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5643',
        changeOrigin: false,
      },
    },
  },
});
