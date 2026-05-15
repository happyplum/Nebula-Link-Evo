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
  },
  resolve: {
    alias: {
      '@nebula-link-evo/shared': path.resolve(__dirname, '../shared/src'),
    },
  },
});