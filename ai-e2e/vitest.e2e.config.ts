import { defineConfig } from 'vitest/config';

process.env.LOG_LEVEL = 'fatal';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
