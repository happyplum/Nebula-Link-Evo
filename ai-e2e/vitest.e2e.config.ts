import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
