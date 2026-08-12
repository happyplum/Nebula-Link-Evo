import type { DebugPlaywrightState, DebugStatusReason } from '@nebula-link-evo/shared';
import type { Page } from 'playwright';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { BrowserLifecycle, type StateChangeReason } from './browser-lifecycle.js';

import { PageActions, MarkerActionResult } from './page-actions.js';
import { DOMExtractor } from './dom-extractor.js';
import { createWorkerLogger, type Logger } from '../../services/logger.js';
import { acquireLock, browserMutex } from './browser-lock.js';

export type { MarkerActionResult, StateChangeReason };

export class BrowserService {
  private static instance: BrowserService | null = null;
  private lifecycle: BrowserLifecycle;
  private pageActions: PageActions;
  private domExtractor: DOMExtractor;
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('BrowserService');
    this.lifecycle = new BrowserLifecycle(this.logger);
    this.pageActions = new PageActions();
    this.domExtractor = new DOMExtractor(this.logger);
  }

  static getInstance(): BrowserService {
    if (!BrowserService.instance) {
      BrowserService.instance = new BrowserService();
    }
    return BrowserService.instance;
  }

  isOpen(): boolean {
    return this.lifecycle.isOpen();
  }

  getCdpPort(): number {
    return this.lifecycle.getCdpPort();
  }

  getCurrentUrl(): string | undefined {
    return this.lifecycle.getCurrentUrl();
  }

  getViewport(): { width: number; height: number } | null {
    return this.lifecycle.getViewport();
  }

  async getTabs(
    owner?: string
  ): Promise<Array<{ id: string; url: string; title: string; isActive: boolean }>> {
    const release = await acquireLock(owner ?? 'BrowserService.getTabs');
    try {
      return await this.lifecycle.getTabs();
    } finally {
      release();
    }
  }

  async switchTab(id: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.switchTab');
    try {
      const page = await this.lifecycle.switchTab(id);
      this.pageActions.setPage(page);
      this.domExtractor.setPage(page);
    } finally {
      release();
    }
  }

  async closeActiveTab(returnToId?: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.closeActiveTab');
    try {
      const page = await this.lifecycle.closeActiveTab(returnToId);
      this.pageActions.setPage(page);
      this.domExtractor.setPage(page);
    } finally {
      release();
    }
  }

  async open(
    headless: boolean = false,
    viewport = { width: 1920, height: 1080 },
    cdpPort?: number,
    owner?: string
  ): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.open');
    try {
      await this.lifecycle.open({ headless, viewport, cdpPort });
      const page = this.lifecycle.getPage();
      this.pageActions.setPage(page);
      this.domExtractor.setPage(page);
    } finally {
      release();
    }
  }

  async close(owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.close');
    try {
      await this.lifecycle.close();
      this.pageActions.setPage(null);
      this.domExtractor.setPage(null);
    } finally {
      release();
    }
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle',
    owner?: string
  ): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.navigate');
    try {
      return await this.lifecycle.navigate(url, waitUntil);
    } finally {
      release();
    }
  }

  async screenshot(
    fullPage: boolean = false,
    owner?: string
  ): Promise<{ screenshot: string; viewport: { width: number; height: number } }> {
    const release = await acquireLock(owner ?? 'BrowserService.screenshot');
    try {
      return await this.lifecycle.screenshot(fullPage);
    } finally {
      release();
    }
  }

  async click(x: number, y: number, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.click');
    try {
      return await this.pageActions.click(x, y);
    } finally {
      release();
    }
  }

  async clickBySelector(
    selector: string,
    options?: {
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
      delay?: number;
      force?: boolean;
    },
    owner?: string
  ): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.clickBySelector');
    try {
      return await this.pageActions.clickBySelector(selector, options);
    } finally {
      release();
    }
  }

  async clickByMarker(
    snapshotId: string,
    nebulaId: number,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.clickByMarker');
    try {
      return await this.pageActions.clickByMarker(snapshotId, nebulaId);
    } finally {
      release();
    }
  }

  async type(
    selector: string,
    text: string,
    options?: {
      delay?: number;
      clear?: boolean;
      force?: boolean;
    },
    owner?: string
  ): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.type');
    try {
      return await this.pageActions.type(selector, text, options);
    } finally {
      release();
    }
  }

  async typeByMarker(
    snapshotId: string,
    nebulaId: number,
    text: string,
    options?: {
      delay?: number;
      clear?: boolean;
      force?: boolean;
    },
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.typeByMarker');
    try {
      return await this.pageActions.typeByMarker(snapshotId, nebulaId, text, options);
    } finally {
      release();
    }
  }

  async scroll(x: number = 0, y: number = 0, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.scroll');
    try {
      return await this.pageActions.scroll(x, y);
    } finally {
      release();
    }
  }

  async focus(selector: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.focus');
    try {
      return await this.pageActions.focus(selector);
    } finally {
      release();
    }
  }

  async blur(selector: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.blur');
    try {
      return await this.pageActions.blur(selector);
    } finally {
      release();
    }
  }

  async hover(selector: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.hover');
    try {
      return await this.pageActions.hover(selector);
    } finally {
      release();
    }
  }

  async setValue(selector: string, value: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.setValue');
    try {
      return await this.pageActions.setValue(selector, value);
    } finally {
      release();
    }
  }

  async dispatchEvent(selector: string, eventType: string, owner?: string): Promise<void> {
    const release = await acquireLock(owner ?? 'BrowserService.dispatchEvent');
    try {
      return await this.pageActions.dispatchEvent(selector, eventType);
    } finally {
      release();
    }
  }

  async focusByMarker(
    snapshotId: string,
    nebulaId: number,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.focusByMarker');
    try {
      return await this.pageActions.focusByMarker(snapshotId, nebulaId);
    } finally {
      release();
    }
  }

  async blurByMarker(
    snapshotId: string,
    nebulaId: number,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.blurByMarker');
    try {
      return await this.pageActions.blurByMarker(snapshotId, nebulaId);
    } finally {
      release();
    }
  }

  async hoverByMarker(
    snapshotId: string,
    nebulaId: number,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.hoverByMarker');
    try {
      return await this.pageActions.hoverByMarker(snapshotId, nebulaId);
    } finally {
      release();
    }
  }

  async setValueByMarker(
    snapshotId: string,
    nebulaId: number,
    value: string,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.setValueByMarker');
    try {
      return await this.pageActions.setValueByMarker(snapshotId, nebulaId, value);
    } finally {
      release();
    }
  }

  async dispatchEventByMarker(
    snapshotId: string,
    nebulaId: number,
    eventType: string,
    owner?: string
  ): Promise<MarkerActionResult> {
    const release = await acquireLock(owner ?? 'BrowserService.dispatchEventByMarker');
    try {
      return await this.pageActions.dispatchEventByMarker(snapshotId, nebulaId, eventType);
    } finally {
      release();
    }
  }

  async getSimplifiedDOMV2(owner?: string): Promise<DOMSnapshotResponse> {
    const release = await acquireLock(owner ?? 'BrowserService.getSimplifiedDOMV2');
    try {
      return await this.domExtractor.getSimplifiedDOMV2();
    } finally {
      release();
    }
  }

  async getCdpEndpoint(owner?: string): Promise<string | null> {
    const release = await acquireLock(owner ?? 'BrowserService.getCdpEndpoint');
    try {
      return await this.lifecycle.getCdpEndpoint();
    } finally {
      release();
    }
  }

  async getTitle(owner?: string): Promise<string | undefined> {
    const release = await acquireLock(owner ?? 'BrowserService.getTitle');
    try {
      return await this.lifecycle.getTitle();
    } finally {
      release();
    }
  }

  getPage(): Page | null {
    return this.lifecycle.getPage();
  }

  async withPage<T>(owner: string, callback: (page: Page) => Promise<T>): Promise<T> {
    const release = await acquireLock(owner);
    try {
      const page = this.lifecycle.getPage();
      if (!page || page.isClosed()) {
        throw new Error('Browser not opened');
      }
      return await callback(page);
    } finally {
      release();
    }
  }

  async executeScript(script: string, _args: unknown[] = [], owner?: string): Promise<unknown> {
    const release = await acquireLock(owner ?? 'BrowserService.executeScript');
    try {
      return await this.pageActions.executeScript(script);
    } finally {
      release();
    }
  }

  async getElementAt(
    x: number,
    y: number,
    owner?: string
  ): Promise<{
    selector: string;
    tag: string;
    id?: string;
    class?: string;
    type?: string;
    name?: string;
    placeholder?: string;
    text?: string;
    href?: string;
    src?: string;
    alt?: string;
    bbox?: { x: number; y: number; width: number; height: number };
    isVisible: boolean;
    isInteractable: boolean;
  } | null> {
    const release = await acquireLock(owner ?? 'BrowserService.getElementAt');
    try {
      return await this.pageActions.getElementAt(x, y);
    } finally {
      release();
    }
  }

  static resetInstance(): void {
    BrowserService.instance = null;
  }

  /** Register callback for unexpected state changes (page closed, browser disconnected) */
  setOnStateChange(callback: ((reason: StateChangeReason) => void) | null): void {
    this.lifecycle.setOnStateChange(callback);
  }

  /** Build a unified debug status snapshot */
  async getDebugStatus(reason?: DebugStatusReason, owner?: string): Promise<DebugPlaywrightState> {
    const release = await acquireLock(owner ?? 'BrowserService.getDebugStatus');
    try {
      const isOpen = this.isOpen();
      let title: string | null = null;

      if (isOpen) {
        try {
          title = (await this.lifecycle.getTitle()) ?? null;
        } catch {
          // Browser/page teardown may race status snapshots.
        }
      }

      if (browserMutex.isLocked()) {
        this.logger.debug('Browser mutex is held while building debug status');
      }

      return {
        isOpen,
        url: this.getCurrentUrl() ?? null,
        title,
        status: isOpen ? 'ready' : 'unknown',
        viewport: this.getViewport() ?? undefined,
        reason,
      };
    } finally {
      release();
    }
  }
}

export const browserService = BrowserService.getInstance();
