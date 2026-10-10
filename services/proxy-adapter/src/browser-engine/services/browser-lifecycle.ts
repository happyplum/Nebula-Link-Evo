import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as crypto from 'node:crypto';
import { startPublisher, stopPublisher } from '../../services/livekit-publisher.js';
import { screencastManager } from '../screencast.js';
import { createWorkerLogger, type Logger } from '../../services/logger.js';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export interface BrowserState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  cdpPort: number;
  lastHeadless: boolean | null;
  lastViewport: { width: number; height: number } | null;
  lastCdpPort: number | null;
  currentOwner: string | null;
}

export interface OpenBrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  cdpPort?: number;
}

export interface NavigateOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeout?: number;
}

export type StateChangeReason = 'page_closed' | 'browser_disconnected';

export class BrowserLifecycle {
  private state: BrowserState = {
    browser: null,
    context: null,
    page: null,
    cdpPort: 0,
    lastHeadless: null,
    lastViewport: null,
    lastCdpPort: null,
    currentOwner: null,
  };
  private pageIds = new WeakMap<Page, string>();
  private switchVersion = 0;
  private logger: Logger;

  private onStateChange: ((reason: StateChangeReason) => void) | null = null;
  private handlePageClose = (): void => {
    this.onStateChange?.('page_closed');
  };

  /** Clean up stale state when browser disconnects unexpectedly */
  private handleDisconnect = (): void => {
    this.state.browser = null;
    this.state.context = null;
    this.state.page = null;
    this.state.cdpPort = 0;
    this.state.currentOwner = null;
    this.onStateChange?.('browser_disconnected');
  };

  constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('BrowserLifecycle');
  }

  /** Register callback for state changes (page closed, browser disconnected) */
  setOnStateChange(callback: ((reason: StateChangeReason) => void) | null): void {
    this.onStateChange = callback;
  }

  getState(): Readonly<BrowserState> {
    return this.state;
  }

  isOpen(): boolean {
    return (
      this.state.browser !== null &&
      this.state.browser.isConnected() &&
      this.state.page !== null &&
      !this.state.page.isClosed()
    );
  }

  getPage(): Page | null {
    return this.state.page;
  }

  getCdpPort(): number {
    return this.state.cdpPort;
  }

  getCurrentUrl(): string | undefined {
    return this.state.page?.url();
  }

  getViewport(): { width: number; height: number } | null {
    return this.state.lastViewport;
  }

  async getTitle(): Promise<string | undefined> {
    return this.state.page?.title();
  }

  async getTabs(): Promise<Array<{ id: string; url: string; title: string; isActive: boolean }>> {
    if (!this.state.context) return [];

    const pages = this.state.context.pages();
    const tabs = [];

    for (const p of pages) {
      let pageId = this.pageIds.get(p);
      if (!pageId) {
        pageId = crypto.randomUUID();
        this.pageIds.set(p, pageId);
      }
      tabs.push({
        id: pageId,
        url: p.url(),
        title: await p.title(),
        isActive: p === this.state.page,
      });
    }
    return tabs;
  }

  async switchTab(id: string): Promise<Page> {
    if (!this.state.context) throw new Error('Browser not opened');

    const pages = this.state.context.pages();
    const targetPage = pages.find((p) => this.pageIds.get(p) === id);

    if (!targetPage) {
      throw new Error(`Tab with id ${id} not found`);
    }

    if (this.state.page === targetPage) {
      return targetPage;
    }

    const currentVersion = ++this.switchVersion;
    await targetPage.bringToFront();

    // Capture which transports were active BEFORE teardown
    const wasScreencastActive = screencastManager.isActive();
    const previousViewport = this.state.lastViewport;
    const oldPage = this.state.page;

    if (oldPage && !oldPage.isClosed()) {
      oldPage.off('close', this.handlePageClose);
    }

    this.state.page = targetPage;
    targetPage.off('close', this.handlePageClose);
    this.state.page.on('close', this.handlePageClose);

    this.restartTransportsForPage(
      targetPage,
      wasScreencastActive,
      previousViewport,
      currentVersion
    ).catch((error) => {
      this.logger.warn({ err: error }, 'Background transport restart failed');
    });

    return targetPage;
  }

  async closeActiveTab(returnToId?: string): Promise<Page> {
    if (!this.state.context || !this.state.page) {
      throw new Error('Browser not opened');
    }

    const activePage = this.state.page;
    const remainingPages = this.state.context.pages().filter((page) => page !== activePage);
    if (remainingPages.length === 0) {
      throw new Error('Cannot close the only browser tab');
    }

    const returnPage = returnToId
      ? remainingPages.find((page) => this.pageIds.get(page) === returnToId)
      : remainingPages[0];
    if (!returnPage) {
      throw new Error(`Return tab with id ${returnToId} not found`);
    }

    const currentVersion = ++this.switchVersion;
    const wasScreencastActive = screencastManager.isActive();
    const previousViewport = this.state.lastViewport;
    activePage.off('close', this.handlePageClose);
    await activePage.close();

    this.state.page = returnPage;
    if (!this.pageIds.has(returnPage)) {
      this.pageIds.set(returnPage, crypto.randomUUID());
    }
    returnPage.off('close', this.handlePageClose);
    returnPage.on('close', this.handlePageClose);
    await returnPage.bringToFront();

    this.restartTransportsForPage(
      returnPage,
      wasScreencastActive,
      previousViewport,
      currentVersion
    ).catch((error) => {
      this.logger.warn({ err: error }, 'Background transport restart failed after tab close');
    });
    return returnPage;
  }

  private async restartTransportsForPage(
    targetPage: Page,
    wasScreencastActive: boolean,
    viewport: { width: number; height: number } | null,
    version: number
  ): Promise<void> {
    if (version !== this.switchVersion) {
      this.logger.warn('Skipping stale tab switch before stopPublisher');
      return;
    }

    await withTimeout(stopPublisher(), 10000, 'stopPublisher').catch((error) => {
      this.logger.warn({ err: error }, 'Publisher failed to stop during tab switch');
    });

    if (wasScreencastActive) {
      if (version !== this.switchVersion) {
        this.logger.warn('Skipping stale tab switch before screencast stop');
        return;
      }

      await withTimeout(screencastManager.stop(), 5000, 'screencastManager.stop').catch((error) => {
        this.logger.warn({ err: error }, 'Screencast failed to stop during tab switch');
      });
    }

    if (viewport) {
      if (version !== this.switchVersion) {
        this.logger.warn('Skipping stale tab switch before startPublisher');
        return;
      }

      await withTimeout(startPublisher(targetPage, viewport), 10000, 'startPublisher').catch(
        (error) => {
          this.logger.warn({ err: error }, 'Publisher failed to restart for new tab');
        }
      );
    }

    if (wasScreencastActive) {
      if (version !== this.switchVersion) {
        this.logger.warn('Skipping stale tab switch before screencast start');
        return;
      }

      await withTimeout(screencastManager.start(targetPage), 5000, 'screencastManager.start').catch(
        (error) => {
          this.logger.warn({ err: error }, 'Screencast failed to restart for new tab');
        }
      );
    }
  }

  private async startScreencastForPage(page: Page): Promise<void> {
    await withTimeout(screencastManager.start(page), 5000, 'screencastManager.start').catch(
      (error) => {
        this.logger.warn({ err: error }, 'Screencast failed to start');
      }
    );
  }

  async open(options: OpenBrowserOptions = {}): Promise<void> {
    const { headless = false, viewport = { width: 1920, height: 1080 }, cdpPort } = options;
    const nextCdpPort = cdpPort ?? 0;

    // Detect stale browser: disconnected process or closed page (user closed the window)
    // With --remote-debugging-port, Chromium process stays alive after window close,
    // so isConnected() returns true and 'disconnected' never fires.
    const isStale =
      this.state.browser &&
      (!this.state.browser.isConnected() ||
        (this.state.page !== null && this.state.page.isClosed()));
    if (isStale) {
      try {
        await this.close();
      } catch {
        this.handleDisconnect();
      }
    }

    if (this.state.browser) {
      const headlessChanged =
        this.state.lastHeadless !== null && headless !== this.state.lastHeadless;
      const cdpPortChanged =
        this.state.lastCdpPort !== null && nextCdpPort !== this.state.lastCdpPort;
      const viewportChanged =
        this.state.lastViewport !== null &&
        (viewport.width !== this.state.lastViewport.width ||
          viewport.height !== this.state.lastViewport.height);

      if (
        headlessChanged ||
        cdpPortChanged ||
        (viewportChanged && this.state.context !== null && this.state.page !== null)
      ) {
        this.logger.warn(
          { headless, viewport, cdpPort: nextCdpPort },
          'Browser already open; new open() parameters will not fully take effect. Call close() before open() to apply changes.'
        );
      }

      if (!this.state.context || !this.state.page) {
        this.state.context = await this.state.browser.newContext({
          viewport,
          deviceScaleFactor: 1,
        });
        this.state.page = await this.state.context.newPage();
        this.pageIds.set(this.state.page, crypto.randomUUID());
        this.state.page.on('close', this.handlePageClose);
        this.state.lastViewport = { ...viewport };
        await this.startScreencastForPage(this.state.page);
        // Fire-and-forget: publisher connects to LiveKit and may block
        // if the server is unavailable. Don't delay open() response.
        startPublisher(this.state.page, viewport).catch((err) => {
          this.logger.warn({ err }, 'Publisher failed to start');
        });
      }
      return;
    }

    this.state.cdpPort = nextCdpPort;

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      ...(this.state.cdpPort > 0 ? [`--remote-debugging-port=${this.state.cdpPort}`] : []),
    ];

    this.state.browser = await chromium.launch({
      headless,
      args: launchArgs,
    });
    this.state.browser.on('disconnected', this.handleDisconnect);
    this.state.context = await this.state.browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    this.state.page = await this.state.context.newPage();
    this.pageIds.set(this.state.page, crypto.randomUUID());
    this.state.page.on('close', this.handlePageClose);
    this.state.lastHeadless = headless;
    this.state.lastViewport = { ...viewport };
    this.state.lastCdpPort = nextCdpPort;
    await this.startScreencastForPage(this.state.page);
    // Fire-and-forget: publisher connects to LiveKit and may block
    // if the server is unavailable. Don't delay open() response.
    startPublisher(this.state.page, viewport).catch((err) => {
      this.logger.warn({ err }, 'Publisher failed to start');
    });
  }

  async close(): Promise<void> {
    await stopPublisher().catch(() => {});
    await screencastManager.stop().catch(() => {});
    if (this.state.browser) {
      this.state.browser.off('disconnected', this.handleDisconnect);
      if (this.state.page) {
        this.state.page.off('close', this.handlePageClose);
      }
      if (this.state.browser.isConnected()) {
        await this.state.browser.close();
      }
      this.state.browser = null;
      this.state.context = null;
      this.state.page = null;
      this.state.cdpPort = 0;
      this.state.lastHeadless = null;
      this.state.lastViewport = null;
      this.state.lastCdpPort = null;
      this.state.currentOwner = null;
    }
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'
  ): Promise<void> {
    if (!this.state.page) throw new Error('Browser not opened');
    await this.state.page.goto(url, { waitUntil, timeout: 30000 });
  }

  async screenshot(
    fullPage: boolean = false
  ): Promise<{ screenshot: string; viewport: { width: number; height: number } }> {
    if (!this.state.page) throw new Error('Browser not opened');

    const screenshot = await this.state.page.screenshot({
      fullPage,
      type: 'png',
    });

    const viewport = this.state.page.viewportSize() || { width: 1920, height: 1080 };

    return {
      screenshot: screenshot.toString('base64'),
      viewport,
    };
  }

  async getCdpEndpoint(): Promise<string | null> {
    if (!this.state.browser || this.state.cdpPort === 0) return null;
    try {
      const response = await fetch(`http://localhost:${this.state.cdpPort}/json`);
      const targets = (await response.json()) as Array<{ webSocketDebuggerUrl?: string }>;
      if (targets.length > 0 && targets[0].webSocketDebuggerUrl) {
        return targets[0].webSocketDebuggerUrl;
      }
      return null;
    } catch {
      return null;
    }
  }
}
