import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

const aiTarget = process.env.DEBUG_UI_AI_TARGET ?? 'http://localhost:3001';
const proxyTarget = process.env.DEBUG_UI_PROXY_TARGET ?? 'http://localhost:3000';
const proxyWebSocketTarget = proxyTarget.replace(/^http/u, 'ws');

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
      '^/api/v1/chat(/.*)?': { target: aiTarget, changeOrigin: true },
      '^/api/v1/ai(/.*)?': { target: aiTarget, changeOrigin: true },
      '^/api/v1/test-ai': { target: aiTarget, changeOrigin: true },
      '^/api/v1/config': { target: aiTarget, changeOrigin: true },

      // Browser/Debug endpoints -> 3000
      '/api': { target: proxyTarget, changeOrigin: true },
      '/ws': { target: proxyWebSocketTarget, ws: true, changeOrigin: true },
      '/debug/api': { target: proxyTarget, changeOrigin: true },
      '/debug/stream': { target: proxyTarget, changeOrigin: true },
      '/mcp': { target: proxyTarget, changeOrigin: true },
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
