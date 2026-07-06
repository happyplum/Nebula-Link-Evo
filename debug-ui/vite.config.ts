import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/debug/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      // Chat/AI endpoints -> 3001
      '^/api/v1/chat(/.*)?': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/chat(/.*)?': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/v1/ai(/.*)?': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/ai(/.*)?': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/v1/test-ai': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/test-ai': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/v1/verify-keys': { target: 'http://localhost:3001', changeOrigin: true },
      '^/api/verify-keys': { target: 'http://localhost:3001', changeOrigin: true },
      
      // Browser/Debug endpoints -> 3000
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:3000', ws: true, changeOrigin: true },
      '/debug/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/debug/stream': { target: 'http://localhost:3000', changeOrigin: true },
      '/mcp': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-livekit': ['livekit-client'],
        },
      },
    },
  },
});
