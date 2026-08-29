import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    // Use 1 worker to avoid concurrent database conflicts with DatabaseManager singleton
    workers: 1,
    // Longer timeouts for tests that need them
    testTimeout: 10000,
    hookTimeout: 10000,
    // Include test files
    include: ['src/**/__tests__/**/*.ts'],
    // Exclude UI tests (they use their own test setup)
    exclude: ['**/node_modules/**', '**/ui/**'],
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
      },
    },
  },
  resolve: {
    alias: {
      '@nebula-link-evo/shared': path.resolve(import.meta.dirname, '../shared'),
    },
  },
});
