import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['js/**/*.test.ts'],
    setupFiles: ['./js/__tests__/setup.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['js/**/*.ts'],
      exclude: ['js/**/*.test.ts', 'js/**/__tests__/**'],
    },
  },
});
