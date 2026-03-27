import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Debug UI (Dev Mode)
 * Uses existing running servers
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/debug-ui/specs',
  timeout: 30 * 1000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173/debug/',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
      },
    },
  ],
});
