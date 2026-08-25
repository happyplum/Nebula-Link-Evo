import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        statements: 56,
        branches: 48,
        functions: 62,
        lines: 57,
        'src/conversation/chat-handler.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/services/conversation-job-queue.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/vision/snapshot-loader.ts': {
          statements: 75,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/vision/vision-analyzer.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'src/tools/providers/vision-tool-provider.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
