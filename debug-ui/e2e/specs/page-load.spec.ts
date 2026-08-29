import { test, expect } from '../fixtures/test.fixture';

test.describe('Debug UI shell', () => {
  test('loads the current shell and primary panels', async ({ debugPage }) => {
    await expect(debugPage).toHaveURL(/\/debug\/?$/);
    await expect(debugPage).toHaveTitle('Nebula-Link Debug');
    await expect(debugPage.getByTestId('debug-shell')).toBeVisible();
    await expect(debugPage.getByTestId('debug-sidebar')).toBeVisible();
    await expect(debugPage.getByTestId('debug-main')).toBeVisible();
    await expect(debugPage.getByTestId('debug-right-panel')).toBeVisible();
    await expect(debugPage.getByTestId('monitor-sidebar')).toBeVisible();
    await expect(debugPage.getByTestId('monitor-main')).toBeVisible();
  });

  test('switches the three current activity views and the right panel', async ({ debugPage }) => {
    await expect(debugPage.getByTestId('activity-bar').getByRole('button')).toHaveCount(3);

    await debugPage.getByTestId('activity-btn-control').click();
    await expect(debugPage.getByTestId('control-browser-basic-status')).toBeVisible();
    await expect(debugPage.getByTestId('control-page-interaction')).toBeVisible();
    await expect(debugPage.getByTestId('control-operation-logs')).toBeVisible();

    await debugPage.getByTestId('activity-btn-ai').click();
    await expect(debugPage.getByTestId('chat-page-root')).toBeVisible();

    await debugPage.getByTestId('tabs-config').click();
    await expect(debugPage.getByTestId('config-content')).toBeVisible();
  });

  test('loads LiveKit only after WebRTC is selected', async ({ browser, testOptions }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const livekitRequests: string[] = [];
    let healthResponses = 0;

    page.on('request', (request) => {
      if (request.url().toLowerCase().includes('livekit')) livekitRequests.push(request.url());
    });
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/debug/api/health' && response.ok()) {
        healthResponses += 1;
      }
    });

    await page.goto(testOptions.debugURL);
    await expect(page.getByTestId('monitor-main')).toBeVisible();
    await expect.poll(() => healthResponses).toBeGreaterThan(0);
    expect(livekitRequests).toEqual([]);

    await page.getByRole('button', { name: 'WebRTC', exact: true }).click();
    await expect.poll(() => livekitRequests.length).toBeGreaterThan(0);

    await context.close();
  });
});

test.describe('Debug SSE transport', () => {
  test('opens the canonical debug stream through the Vite proxy', async ({
    debugPage: _debugPage,
    sseMonitor,
  }) => {
    await expect.poll(() => sseMonitor.requests).toBeGreaterThan(0);
    await expect.poll(() => sseMonitor.responses).toBeGreaterThan(0);
    expect(sseMonitor.lastStatus).toBe(200);
  });

  test('keeps the shell usable while the stream is unavailable', async ({
    browser,
    testOptions,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors: Error[] = [];
    let healthResponses = 0;
    page.on('pageerror', (error) => pageErrors.push(error));
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/debug/api/health' && response.ok()) {
        healthResponses += 1;
      }
    });
    await page.route('**/debug/api/stream', (route) => route.abort('connectionfailed'));

    await page.goto(testOptions.debugURL);
    await expect(page.getByTestId('debug-shell')).toBeVisible();
    await expect.poll(() => healthResponses).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);

    await context.close();
  });

  test('reconnects after the first SSE request fails', async ({ browser, testOptions }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    let streamRequests = 0;
    let successfulResponses = 0;
    await page.route('**/debug/api/stream', async (route) => {
      streamRequests += 1;
      if (streamRequests === 1) {
        await route.abort('connectionfailed');
        return;
      }
      await route.continue();
    });
    page.on('response', (response) => {
      if (new URL(response.url()).pathname === '/debug/api/stream' && response.ok()) {
        successfulResponses += 1;
      }
    });

    await page.goto(testOptions.debugURL);
    await expect(page.getByTestId('debug-shell')).toBeVisible();
    await expect.poll(() => streamRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => successfulResponses).toBeGreaterThan(0);

    await context.close();
  });
});

test.describe('Chat SSE transport', () => {
  test('creates a session and renders a streamed assistant response', async ({ debugPage }) => {
    await debugPage.getByTestId('activity-btn-ai').click();
    await expect(debugPage.getByTestId('chat-page-root')).toBeVisible();
    debugPage.once('dialog', (dialog) => dialog.accept('E2E Chat'));
    await debugPage.getByTitle('新建会话').click();

    const composer = debugPage.getByTestId('composer-input');
    await expect(composer).toBeEnabled();
    await composer.fill('Hello from Playwright');
    await debugPage.getByTestId('send-button').click();

    await expect(debugPage.getByTestId('message-list')).toContainText('Hello from Playwright');
    await expect(debugPage.getByTestId('message-list')).toContainText('E2E assistant response', {
      timeout: 15_000,
    });
  });
});
