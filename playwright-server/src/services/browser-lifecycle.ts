import { chromium, Browser, Page, BrowserContext } from 'playwright';

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

  getState(): Readonly<BrowserState> {
    return this.state;
  }

  isOpen(): boolean {
    return this.state.browser !== null && this.state.page !== null;
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

  async getTitle(): Promise<string | undefined> {
    return this.state.page?.title();
  }

  async open(options: OpenBrowserOptions = {}): Promise<void> {
    const { headless = false, viewport = { width: 1920, height: 1080 }, cdpPort } = options;
    const nextCdpPort = cdpPort ?? 0;

    if (this.state.browser) {
      const headlessChanged = this.state.lastHeadless !== null && headless !== this.state.lastHeadless;
      const cdpPortChanged = this.state.lastCdpPort !== null && nextCdpPort !== this.state.lastCdpPort;
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
        this.state.lastViewport = { ...viewport };
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
    this.state.context = await this.state.browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    this.state.page = await this.state.context.newPage();
    this.state.lastHeadless = headless;
    this.state.lastViewport = { ...viewport };
    this.state.lastCdpPort = nextCdpPort;
  }

  async close(): Promise<void> {
    if (this.state.browser) {
      await this.state.browser.close();
      this.state.browser = null;
      this.state.context = null;
      this.state.page = null;
      this.state.cdpPort = 0;
      this.state.lastHeadless = null;
      this.state.lastViewport = null;
      this.state.lastCdpPort = null;
    }
  }

  async navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'): Promise<void> {
    if (!this.state.page) throw new Error('Browser not opened');
    await this.state.page.goto(url, { waitUntil, timeout: 30000 });
  }

  async screenshot(fullPage: boolean = false): Promise<{ screenshot: string; viewport: { width: number; height: number } }> {
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