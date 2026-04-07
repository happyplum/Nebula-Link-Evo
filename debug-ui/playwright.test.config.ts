import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Debug UI
 * Test configuration without webServer auto-start
 */
export default defineConfig({
  testDir: './e2e/specs',

  timeout: 60 * 1000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['line'], ['html', { outputFolder: 'playwright-report/html' }]],
  use: {
    baseURL: 'http://localhost:5173/debug',
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

  // webServer is disabled - services must be started manually
  // webServer: {
  //   command: 'pnpm -C .. dev',
  //   url: 'http://localhost:5173/debug/',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 180 * 1000,
  // },
});
