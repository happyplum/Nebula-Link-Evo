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
        lines: 55
      }
    }
  }
});
