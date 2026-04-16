import { chromium, Browser, Page, BrowserContext } from 'playwright';
import * as crypto from 'node:crypto';
import { startPublisher, stopPublisher } from '../livekit-publisher.js';

export interface BrowserState {
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  cdpPort: number;
  lastHeadless: boolean | null;
  lastViewport: { width: number; height: number } | null;
  lastCdpPort: number | null;
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
  };
  private pageIds = new WeakMap<Page, string>();

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
    this.onStateChange?.('browser_disconnected');
  };

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
      if (!this.pageIds.has(p)) {
        this.pageIds.set(p, crypto.randomUUID());
      }
      tabs.push({
        id: this.pageIds.get(p)!,
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

    await targetPage.bringToFront();
    
    // Refresh livekit publisher for the new page
    if (this.state.page) {
      await stopPublisher().catch(() => {});
    }
    
    this.state.page = targetPage;
    this.state.page.on('close', this.handlePageClose);

    if (this.state.lastViewport) {
      void startPublisher(this.state.page, this.state.lastViewport).catch((err) => {
        console.warn('[LiveKit] Publisher failed to restart for new tab:', err);
      });
    }

    return targetPage;
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
        console.warn(
          'Browser already open; new open() parameters will not fully take effect. Call close() before open() to apply headless/cdpPort and active viewport changes.',
          {
            headless,
            viewport,
            cdpPort: nextCdpPort,
          }
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
        void startPublisher(this.state.page, viewport).catch((err) => {
          console.warn('[LiveKit] Publisher failed to start:', err);
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
    void startPublisher(this.state.page, viewport).catch((err) => {
      console.warn('[LiveKit] Publisher failed to start:', err);
    });
  }

  async close(): Promise<void> {
    void stopPublisher().catch(() => {});
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
