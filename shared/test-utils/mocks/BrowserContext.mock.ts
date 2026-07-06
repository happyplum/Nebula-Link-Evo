import { vi } from 'vitest';
import type { Page, BrowserContext as PlaywrightBrowserContext } from 'playwright';
import type {
  BrowserState,
  OpenBrowserOptions,
  NavigateOptions,
} from '../../../proxy-adapter/src/browser-engine/services/browser-lifecycle.js';

/**
 * Mock Page implementation
 */
interface MockPage {
  goto: ReturnType<typeof vi.fn>;
  screenshot: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  selectOption: ReturnType<typeof vi.fn>;
  check: ReturnType<typeof vi.fn>;
  uncheck: ReturnType<typeof vi.fn>;
  hover: ReturnType<typeof vi.fn>;
  scroll: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  $: ReturnType<typeof vi.fn>;
  $$: ReturnType<typeof vi.fn>;
  locator: ReturnType<typeof vi.fn>;
  waitForSelector: ReturnType<typeof vi.fn>;
  waitForLoadState: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  setViewportSize: ReturnType<typeof vi.fn>;
  addInitScript: ReturnType<typeof vi.fn>;
  isClosed: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
}

/**
 * Create a mock Playwright Page
 */
export function createMockPage(): MockPage {
  const mockPage: MockPage = {
    goto: vi.fn(),
    screenshot: vi.fn(),
    click: vi.fn(),
    fill: vi.fn(),
    type: vi.fn(),
    press: vi.fn(),
    selectOption: vi.fn(),
    check: vi.fn(),
    uncheck: vi.fn(),
    hover: vi.fn(),
    scroll: vi.fn(),
    evaluate: vi.fn(),
    $: vi.fn(),
    $$: vi.fn(),
    locator: vi.fn(),
    waitForSelector: vi.fn(),
    waitForLoadState: vi.fn(),
    waitForTimeout: vi.fn(),
    close: vi.fn(),
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(() => 'Example Page'),
    content: vi.fn(() => '<html></html>'),
    setViewportSize: vi.fn(),
    addInitScript: vi.fn(),
    isClosed: vi.fn(() => false),
    on: vi.fn(),
    off: vi.fn(),
  };

  // Setup mock return values
  mockPage.goto.mockResolvedValue(undefined);
  mockPage.screenshot.mockResolvedValue(Buffer.from('fake-screenshot'));
  mockPage.click.mockResolvedValue(undefined);
  mockPage.fill.mockResolvedValue(undefined);
  mockPage.type.mockResolvedValue(undefined);
  mockPage.press.mockResolvedValue(undefined);
  mockPage.selectOption.mockResolvedValue(undefined);
  mockPage.check.mockResolvedValue(undefined);
  mockPage.uncheck.mockResolvedValue(undefined);
  mockPage.hover.mockResolvedValue(undefined);
  mockPage.scroll.mockResolvedValue(undefined);
  mockPage.evaluate.mockResolvedValue(null);
  mockPage.waitForSelector.mockResolvedValue(null);
  mockPage.waitForLoadState.mockResolvedValue(undefined);
  mockPage.waitForTimeout.mockResolvedValue(undefined);
  mockPage.close.mockResolvedValue(undefined);
  mockPage.setViewportSize.mockResolvedValue(undefined);
  mockPage.addInitScript.mockResolvedValue(undefined);

  return mockPage;
}

/**
 * Create a mock Playwright BrowserContext
 */
export function createBrowserContextMock(config?: {
  pages?: MockPage[];
  shouldFail?: boolean;
  closed?: boolean;
}): PlaywrightBrowserContext {
  const mockConfig = {
    pages: [],
    shouldFail: false,
    closed: false,
    ...config,
  };

  const mockPage = createMockPage();
  const pages = [mockPage, ...(mockConfig.pages || [])];

  const mockContext = {
    pages: vi.fn(() => pages),
    newPage: vi.fn(async () => {
      if (mockConfig.shouldFail) {
        throw new Error('Failed to create new page');
      }
      const newMockPage = createMockPage();
      pages.push(newMockPage);
      return newMockPage as unknown as Page;
    }),
    close: vi.fn(async () => {
      mockConfig.closed = true;
    }),
    addCookies: vi.fn(),
    clearCookies: vi.fn(),
    cookies: vi.fn(() => []),
    grantPermissions: vi.fn(),
    clearPermissions: vi.fn(),
    setGeolocation: vi.fn(),
    setOffline: vi.fn(),
    setHTTPCredentials: vi.fn(),
    route: vi.fn(),
    unroute: vi.fn(),
    storageState: vi.fn(() => ({ cookies: [], origins: [] })),
    waitForEvent: vi.fn(),
  } as unknown as PlaywrightBrowserContext;

  return mockContext;
}

/**
 * Create a mock BrowserLifecycle (browser manager)
 */
export function createBrowserLifecycleMock(config?: {
  state?: Partial<BrowserState>;
  shouldFailOnOpen?: boolean;
  shouldFailOnNavigate?: boolean;
}): any {
  const mockState: BrowserState = {
    browser: null,
    context: null,
    page: null,
    cdpPort: 0,
    lastHeadless: null,
    lastViewport: null,
    lastCdpPort: null,
    currentOwner: null,
    ...config?.state,
  };

  const mockPage = createMockPage();
  const mockContext = createBrowserContextMock();

  return {
    getState: vi.fn(() => mockState),
    isOpen: vi.fn(() => mockState.browser !== null && mockState.page !== null),
    getPage: vi.fn(() => mockState.page),
    getCdpPort: vi.fn(() => mockState.cdpPort),
    getCurrentUrl: vi.fn(() => mockState.page?.url()),
    getTitle: vi.fn(async () => mockState.page?.title()),
    open: vi.fn(async (options: OpenBrowserOptions = {}) => {
      if (config?.shouldFailOnOpen) {
        throw new Error('Failed to open browser');
      }

      mockState.browser = { newContext: vi.fn(async () => mockContext) } as any;
      mockState.context = mockContext;
      mockState.page = mockPage;
      mockState.lastHeadless = options.headless ?? null;
      mockState.lastViewport = options.viewport || { width: 1920, height: 1080 };
      mockState.cdpPort = options.cdpPort || 0;
    }),
    close: vi.fn(async () => {
      mockState.browser = null;
      mockState.context = null;
      mockState.page = null;
      mockState.cdpPort = 0;
      mockState.lastHeadless = null;
      mockState.lastViewport = null;
      mockState.lastCdpPort = null;
    }),
    navigate: vi.fn(
      async (url: string, waitUntil?: 'load' | 'domcontentloaded' | 'networkidle') => {
        if (config?.shouldFailOnNavigate) {
          throw new Error('Failed to navigate');
        }
        if (!mockState.page) {
          throw new Error('Browser not opened');
        }
        await mockPage.goto(url);
      }
    ),
    screenshot: vi.fn(async (fullPage: boolean = false) => {
      if (!mockState.page) {
        throw new Error('Browser not opened');
      }
      const screenshot = await mockPage.screenshot();
      const viewport = mockState.page.url()
        ? { width: 1920, height: 1080 }
        : { width: 0, height: 0 };
      return {
        screenshot: screenshot.toString('base64'),
        viewport,
      };
    }),
    getCdpEndpoint: vi.fn(async () => null),
  };
}

/**
 * Create a mock ElementHandle
 */
export function createMockElementHandle(overrides?: {
  textContent?: string;
  isVisible?: boolean;
  isEnabled?: boolean;
}): any {
  return {
    textContent: vi.fn(async () => overrides?.textContent || ''),
    isVisible: vi.fn(async () => overrides?.isVisible !== false),
    isEnabled: vi.fn(async () => overrides?.isEnabled !== false),
    click: vi.fn(),
    fill: vi.fn(),
    boundingBox: vi.fn(() => ({ x: 0, y: 0, width: 100, height: 50 })),
  };
}
