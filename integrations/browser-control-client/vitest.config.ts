import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 60,
        branches: 60,
        functions: 65,
        lines: 60,
        'src/client.ts': {
          statements: 75,
          branches: 75,
          functions: 65,
          lines: 80,
        },
        'src/controlled-session.ts': {
          statements: 80,
          branches: 70,
          functions: 90,
          lines: 85,
        },
      },
    },
  },
});
