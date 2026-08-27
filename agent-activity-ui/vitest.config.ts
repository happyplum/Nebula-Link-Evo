import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/{reducer,renderer}.ts', 'src/renderer.tsx'],
      thresholds: { statements: 90, branches: 80, functions: 90, lines: 90 },
    },
  },
});
