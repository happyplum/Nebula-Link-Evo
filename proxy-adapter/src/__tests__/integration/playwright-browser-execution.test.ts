import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BrowserService } from '../../browser-engine/index.js';
import { PlaywrightBrowserExecutionBrowser } from '../../browser-execution/playwright-browser.js';
import type { BrowserOperationRequestV1 } from '../../browser-execution/types.js';

describe('PlaywrightBrowserExecutionBrowser', () => {
  let browser: Browser;
  let page: Page;
  let executor: PlaywrightBrowserExecutionBrowser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
    const browserService = {
      getTabs: async () => [
        { id: 'tab-1', url: page.url(), title: await page.title(), isActive: true },
      ],
      switchTab: async () => undefined,
      closeActiveTab: async () => undefined,
      getSimplifiedDOMV2: async () => ({ snapshot_id: 'snapshot-1' }),
      screenshot: async () => ({
        screenshot: (await page.screenshot()).toString('base64'),
        viewport: page.viewportSize(),
      }),
      withPage: async <T>(_owner: string, callback: (activePage: Page) => Promise<T>) =>
        callback(page),
      open: async () => undefined,
      close: async () => undefined,
      setOnStateChange: () => undefined,
    } as unknown as BrowserService;
    executor = new PlaywrightBrowserExecutionBrowser(browserService);
  });

  beforeEach(async () => {
    await page.setContent(`
      <label for="username">User name</label>
      <input id="username" />
      <button type="button" onclick="document.querySelector('#result').textContent = 'Created ' + document.querySelector('#username').value">Add user</button>
      <p id="result"></p>
    `);
  });

  afterAll(async () => {
    await browser.close();
  });

  it('resolves semantic locator candidates and performs visible form actions', async () => {
    const fill = request({
      kind: 'act',
      operation: 'fill',
      target: {
        semantic: '用户名输入框',
        candidates: [{ strategy: 'label', value: 'User name', exact: true }],
        expected: { cardinality: 'exactly_one', visible: true, editable: true },
      },
      args: { value: 'alice' },
    });
    const click = request({
      kind: 'act',
      operation: 'click',
      target: {
        semantic: '新增用户按钮',
        candidates: [{ strategy: 'role', role: 'button', name: 'Add user', exact: true }],
        expected: { cardinality: 'exactly_one', visible: true, enabled: true },
      },
    });

    const fillResult = await executor.execute(envelope(fill));
    const clickResult = await executor.execute(envelope(click));
    const observed = await executor.execute(
      envelope(
        request({
          kind: 'observe',
          operation: 'text',
          target: {
            semantic: '创建结果',
            candidates: [{ strategy: 'css', value: '#result' }],
            expected: { cardinality: 'exactly_one', visible: true },
          },
        })
      )
    );

    expect(fillResult.resolvedTarget).toMatchObject({ strategy: 'label', matchedCount: 1 });
    expect(clickResult.resolvedTarget).toMatchObject({ strategy: 'role', matchedCount: 1 });
    expect(observed.actual).toBe('Created alice');
  });

  it('reports target ambiguity instead of silently picking the first match', async () => {
    await page.setContent('<button>Save</button><button>Save</button>');
    const ambiguous = request({
      kind: 'act',
      operation: 'click',
      target: {
        semantic: '保存按钮',
        candidates: [{ strategy: 'role', role: 'button', name: 'Save', exact: true }],
        expected: { cardinality: 'exactly_one', visible: true },
      },
    });

    await expect(executor.execute(envelope(ambiguous))).rejects.toMatchObject({
      code: 'validation_failed',
      details: { candidates: [{ strategy: 'role', count: 2, reason: 'cardinality' }] },
    });
  });

  it('captures real PNG bytes and a serializable DOM snapshot from the active page', async () => {
    const screenshot = await executor.captureScreenshot('tab-1');
    const dom = await executor.captureDomSnapshot('tab-1');

    expect(screenshot.bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(JSON.parse(dom.bytes.toString('utf8'))).toEqual({ snapshot_id: 'snapshot-1' });
    expect(dom.snapshotId).toBe('snapshot-1');
  });
});

function request(
  overrides: Pick<BrowserOperationRequestV1, 'kind' | 'operation'> &
    Partial<BrowserOperationRequestV1>
): BrowserOperationRequestV1 {
  return {
    schema: 'nebula.browser.operation/1.0',
    operationId: crypto.randomUUID(),
    leaseSequence: 1,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
    ...overrides,
  };
}

function envelope(requestValue: BrowserOperationRequestV1) {
  return {
    sessionId: 'session-1',
    leaseId: 'lease-1',
    leaseToken: 'secret',
    tabId: 'tab-1',
    request: requestValue,
  };
}
