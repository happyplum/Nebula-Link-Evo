import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Configuration for Debug UI
 *
 * - Auto-starts proxy-adapter on port 3000
 * - Requires playwright-server on port 3001 (manual start or via fixture)
 * - Tests run against http://localhost:3000/debug
 * - Screenshots, traces, and videos on failure
 * - Reporters: line, html, junit
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/debug-ui/specs',

  // Timeout settings
  timeout: 30 * 1000,
  expect: {
    timeout: 5000,
  },

  // Run tests in parallel
  fullyParallel: true,

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
    ['junit', { outputFile: 'playwright-report/junit/results.xml' }],
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

  // Run local dev server before starting tests
  webServer: {
    command: 'node dist/server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    timeout: 60 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
