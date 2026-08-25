import { expect, test as base, type Page } from '@playwright/test';

export interface TestOptions {
  debugURL: string;
  debugStreamPath: string;
}

export interface SseMonitor {
  requests: number;
  responses: number;
  failures: number;
  lastStatus: number | null;
}

export type DebugPage = Page;

export const test = base.extend<{
  testOptions: TestOptions;
  sseMonitor: SseMonitor;
  debugPage: DebugPage;
}>({
  testOptions: async ({ baseURL }, use) => {
    await use({
      debugURL: process.env.DEBUG_UI_URL || baseURL || '/debug/',
      debugStreamPath: '/debug/api/stream',
    });
  },

  sseMonitor: async ({ page, testOptions }, use) => {
    const monitor: SseMonitor = {
      requests: 0,
      responses: 0,
      failures: 0,
      lastStatus: null,
    };
    const isDebugStream = (url: string) => new URL(url).pathname === testOptions.debugStreamPath;

    page.on('request', (request) => {
      if (isDebugStream(request.url())) monitor.requests += 1;
    });
    page.on('response', (response) => {
      if (!isDebugStream(response.url())) return;
      monitor.responses += 1;
      monitor.lastStatus = response.status();
    });
    page.on('requestfailed', (request) => {
      if (isDebugStream(request.url())) monitor.failures += 1;
    });

    await use(monitor);
  },

  debugPage: async ({ page, testOptions, sseMonitor: _sseMonitor }, use) => {
    await page.goto(testOptions.debugURL);
    await page.waitForLoadState('domcontentloaded');
    await use(page as DebugPage);
  },
});

export { expect };
