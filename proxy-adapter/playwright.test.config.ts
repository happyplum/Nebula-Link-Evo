import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Debug UI
 * Test configuration without webServer auto-start
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/debug-ui/specs',

  // Timeout settings
  timeout: 60 * 1000,
  expect: {
    timeout: 10000,
  },

  // Run tests in parallel
  fullyParallel: false,

  // Fail if build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['line'],
    ['html', { outputFolder: 'playwright-report/html' }],
  ],

  // Shared settings for all projects
  use: {
    // Base URL for the Debug UI
    baseURL: 'http://localhost:3000/debug',

    // Collect trace on failure
    trace: 'on-first-retry',

    // Screenshot on failure
    screenshot: 'only-on-failure',

    // Video on failure
    video: 'retain-on-failure',

    // Actionability checks
    actionTimeout: 10000,
  },

  // Configure projects for major browsers
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
  //   command: 'pnpm dev',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 60 * 1000,
  // },
});
