import { defineConfig, devices } from '@playwright/test';

const port = requiredPort('AI_E2E_UI_TEST_PORT');
const baseURL = `http://127.0.0.1:${port}/ai-e2e/`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node ../node_modules/tsx/dist/cli.mjs ../src/server.ts',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    env: {
      AI_E2E_PORT: String(port),
      AI_E2E_DB_PATH: requireEnvironment('AI_E2E_UI_TEST_DB_PATH'),
      AI_E2E_COORDINATOR_ENABLED: process.env.AI_E2E_UI_COORDINATOR_ENABLED ?? 'false',
      ...(process.env.AI_CHAT_SERVICE_URL
        ? { AI_CHAT_SERVICE_URL: process.env.AI_CHAT_SERVICE_URL }
        : {}),
      ...(process.env.PROXY_ADAPTER_URL
        ? { PROXY_ADAPTER_URL: process.env.PROXY_ADAPTER_URL }
        : {}),
    },
  },
});

function requiredPort(name: string): number {
  const portValue = Number(requireEnvironment(name));
  if (!Number.isSafeInteger(portValue) || portValue < 1 || portValue > 65_535) {
    throw new Error(`${name} must contain a valid port`);
  }
  return portValue;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set by the isolated E2E launcher`);
  return value;
}
