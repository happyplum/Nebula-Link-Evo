import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./proxy-adapter/', import.meta.url)),
  test: {
    include: ['tests/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
