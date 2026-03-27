import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@mocks': path.resolve(__dirname, '../shared/test-utils/mocks'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      reporter: ['text', 'json', 'html'],
      thresholds: {
        statements: 55,
        functions: 55,
        branches: 55,
        lines: 55,
      },
    },
  },
});
