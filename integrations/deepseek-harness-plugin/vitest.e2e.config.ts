import { defineConfig } from 'vitest/config';

process.env.LOG_LEVEL = 'fatal';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    sequence: { concurrent: false },
  },
});
