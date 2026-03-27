import type { Page } from 'playwright';
import type { SimplifiedDOMResponse } from '../types.js';
import { BrowserLifecycle } from './browser-lifecycle.js';

import { PageActions, MarkerActionResult } from './page-actions.js';
import { DOMExtractor } from './dom-extractor.js';
import { CacheStats } from './snapshot-cache.js';

export type { MarkerActionResult, CacheStats };

export class BrowserService {
  private static instance: BrowserService | null = null;
  private lifecycle: BrowserLifecycle;
  private pageActions: PageActions;
  private domExtractor: DOMExtractor;

  private constructor() {
    this.lifecycle = new BrowserLifecycle();
    this.pageActions = new PageActions();
    this.domExtractor = new DOMExtractor();
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

  async open(
    headless: boolean = false,
    viewport = { width: 1920, height: 1080 },
    cdpPort?: number
  ): Promise<void> {
    await this.lifecycle.open({ headless, viewport, cdpPort });
    const page = this.lifecycle.getPage();
    this.pageActions.setPage(page);
    this.domExtractor.setPage(page);
  }

  async close(): Promise<void> {
    await this.lifecycle.close();
    this.pageActions.setPage(null);
    this.domExtractor.setPage(null);
  }

  async navigate(
    url: string,
    waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'networkidle'
  ): Promise<void> {
    return this.lifecycle.navigate(url, waitUntil);
  }

  async screenshot(
    fullPage: boolean = false
  ): Promise<{ screenshot: string; viewport: { width: number; height: number } }> {
    return this.lifecycle.screenshot(fullPage);
  }

  async click(x: number, y: number): Promise<void> {
    return this.pageActions.click(x, y);
  }

  async clickBySelector(
    selector: string,
    options?: {
      button?: 'left' | 'right' | 'middle';
      clickCount?: number;
      delay?: number;
      force?: boolean;
    }
  ): Promise<void> {
    return this.pageActions.clickBySelector(selector, options);
  }

  async clickByMarker(
    snapshotId: string,
    nebulaId: number
  ): Promise<MarkerActionResult> {
    return this.pageActions.clickByMarker(snapshotId, nebulaId);
  }

  async type(
    selector: string,
    text: string,
    options?: {
      delay?: number;
      clear?: boolean;
      force?: boolean;
    }
  ): Promise<void> {
    return this.pageActions.type(selector, text, options);
  }

  async typeByMarker(
    snapshotId: string,
    nebulaId: number,
    text: string,
    options?: {
      delay?: number;
      clear?: boolean;
      force?: boolean;
    }
  ): Promise<MarkerActionResult> {
    return this.pageActions.typeByMarker(snapshotId, nebulaId, text, options);
  }

  async scroll(x: number = 0, y: number = 0): Promise<void> {
    return this.pageActions.scroll(x, y);
  }

  async focus(selector: string): Promise<void> {
    return this.pageActions.focus(selector);
  }

  async blur(selector: string): Promise<void> {
    return this.pageActions.blur(selector);
  }

  async hover(selector: string): Promise<void> {
    return this.pageActions.hover(selector);
  }

  async setValue(selector: string, value: string): Promise<void> {
    return this.pageActions.setValue(selector, value);
  }

  async dispatchEvent(selector: string, eventType: string): Promise<void> {
    return this.pageActions.dispatchEvent(selector, eventType);
  }

  async focusByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    return this.pageActions.focusByMarker(snapshotId, nebulaId);
  }

  async blurByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    return this.pageActions.blurByMarker(snapshotId, nebulaId);
  }

  async hoverByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    return this.pageActions.hoverByMarker(snapshotId, nebulaId);
  }

  async setValueByMarker(
    snapshotId: string,
    nebulaId: number,
    value: string
  ): Promise<MarkerActionResult> {
    return this.pageActions.setValueByMarker(snapshotId, nebulaId, value);
  }

  async dispatchEventByMarker(
    snapshotId: string,
    nebulaId: number,
    eventType: string
  ): Promise<MarkerActionResult> {
    return this.pageActions.dispatchEventByMarker(snapshotId, nebulaId, eventType);
  }


  async getSimplifiedDOMV2(): Promise<SimplifiedDOMResponse> {
    return this.domExtractor.getSimplifiedDOMV2();
  }

  async getCdpEndpoint(): Promise<string | null> {
    return this.lifecycle.getCdpEndpoint();
  }

  async getTitle(): Promise<string | undefined> {
    return this.lifecycle.getTitle();
  }

  getPage(): Page | null {
    return this.lifecycle.getPage();
  }

  getCacheStats(): CacheStats {
    return this.domExtractor.getCacheStats();
  }

  clearCache(): void {
    this.domExtractor.clearCache();
  }

  async executeScript(script: string, _args: unknown[] = []): Promise<unknown> {
    return this.pageActions.executeScript(script);
  }

  async getElementAt(x: number, y: number): Promise<{
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
    return this.pageActions.getElementAt(x, y);
  }

  static resetInstance(): void {
    BrowserService.instance = null;
  }
}

export const browserService = BrowserService.getInstance();