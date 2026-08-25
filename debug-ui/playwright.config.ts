import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Debug UI
 *
 * - Auto-starts workspace dev services
 * - Tests run against http://localhost:5173/debug
 * - Screenshots, traces, and videos on failure
 * - Reporters: line, html, junit
 */
export default defineConfig({
  testDir: './e2e/specs',

  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report/html' }],
    ['junit', { outputFile: 'playwright-report/junit/results.xml' }],
  ],
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
  webServer: [
    {
      command: 'node ../proxy-adapter/node_modules/tsx/dist/cli.mjs ../proxy-adapter/src/server.ts',
      url: 'http://127.0.0.1:3000/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
      env: {
        HOST: '127.0.0.1',
        PROXY_PORT: '3000',
        TEST_MODE: 'true',
      },
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173/debug/',
      reuseExistingServer: !process.env.CI,
      timeout: 60 * 1000,
    },
  ],
});
