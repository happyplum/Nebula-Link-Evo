import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['index.ts', 'types/**/*.ts', 'utils/**/*.ts'],
      exclude: ['**/*.test.ts', '**/__tests__/**', 'test-utils/**'],
      excludeAfterRemap: true,
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 90,
        lines: 95,
      },
    },
  },
});
