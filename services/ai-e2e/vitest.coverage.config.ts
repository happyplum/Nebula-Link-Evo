import { defineConfig } from 'vitest/config';

process.env.LOG_LEVEL = 'fatal';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.ts', 'tests/e2e/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/ui/**'],
    fileParallelism: false,
    workers: 1,
    testTimeout: 90_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      thresholds: {
        statements: 72,
        branches: 58,
        functions: 78,
        lines: 76,
        'src/database/repositories/authoring-amendment-repository.ts': {
          statements: 75,
          branches: 70,
          functions: 85,
          lines: 80,
        },
        'src/services/semantic-coordinator-service.ts': {
          statements: 75,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/services/semantic-task-projection.ts': {
          statements: 90,
          branches: 80,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
});
