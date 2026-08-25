import { defineConfig, devices } from '@playwright/test';

const proxyPort = requiredPort('DEBUG_UI_E2E_PROXY_PORT');
const aiPort = requiredPort('DEBUG_UI_E2E_AI_PORT');
const uiPort = requiredPort('DEBUG_UI_E2E_UI_PORT');
const proxyURL = `http://127.0.0.1:${proxyPort}`;
const aiURL = `http://127.0.0.1:${aiPort}`;
const uiURL = `http://127.0.0.1:${uiPort}`;

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
    baseURL: `${uiURL}/debug/`,
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
      url: `${proxyURL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 60 * 1000,
      env: {
        HOST: '127.0.0.1',
        PROXY_PORT: String(proxyPort),
        TEST_MODE: 'true',
        LOG_LEVEL: 'error',
      },
    },
    {
      command: 'node scripts/start-ai-chat-e2e.mjs',
      url: `${aiURL}/api/v1/config`,
      reuseExistingServer: false,
      timeout: 60 * 1000,
      env: {
        AI_CHAT_E2E_PORT: String(aiPort),
        PROXY_ADAPTER_URL: proxyURL,
      },
    },
    {
      command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${uiPort}`,
      url: `${uiURL}/debug/`,
      reuseExistingServer: false,
      timeout: 60 * 1000,
      env: {
        DEBUG_UI_AI_TARGET: aiURL,
        DEBUG_UI_PROXY_TARGET: proxyURL,
      },
    },
  ],
});

function requiredPort(name: string): number {
  const port = Number(process.env[name]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be set by the isolated E2E launcher`);
  }
  return port;
}
