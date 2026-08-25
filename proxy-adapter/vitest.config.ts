import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@mocks': path.resolve(__dirname, '../shared/test-utils/mocks'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['src/__tests__/e2e/debug-ui/specs/**/*.e2e.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/static/debug/**', 'src/debug/**', 'src/**/*.test.ts', 'src/**/__tests__/**'],
      thresholds: {
        statements: 55,
        functions: 55,
        branches: 47,
        lines: 55,
        'src/browser-engine/services/browser-service.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/browser-execution/artifact-store.ts': {
          statements: 80,
          branches: 70,
          functions: 90,
          lines: 80,
        },
        'src/browser-execution/repository.ts': {
          statements: 80,
          branches: 70,
          functions: 90,
          lines: 80,
        },
        'src/browser-execution/service.ts': {
          statements: 80,
          branches: 70,
          functions: 85,
          lines: 80,
        },
      },
    },
  },
});
