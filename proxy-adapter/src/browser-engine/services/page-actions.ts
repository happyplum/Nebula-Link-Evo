import { Page } from 'playwright';
import type { BoundingBox } from '@nebula-link-evo/shared';
import { ClickResolutionService, ResolvedTarget } from './click-resolution.js';

export interface MarkerActionResult {
  success: boolean;
  strategy_used: string;
  attempts: number;
  latency_ms: number;
  bbox?: BoundingBox;
  nebulaId?: number;
  selector?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  force?: boolean;
}

export interface TypeOptions {
  delay?: number;
  clear?: boolean;
  force?: boolean;
}

export class PageActions {
  private page: Page | null = null;

  setPage(page: Page | null): void {
    this.page = page;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('Browser not opened');
    return this.page;
  }

  private getErrorCode(message: string): string {
    if (message.includes('Element not found')) return 'element_not_found';
    if (message.includes('timeout')) return 'timeout';
    if (message.includes('not interactable')) return 'not_interactable';
    return 'unknown_error';
  }

  private async determineStrategy(locators: string[], resolved: ResolvedTarget): Promise<string> {
    const strategyIndex = await this.findFirstMatchingStrategy(resolved.locators);

    return strategyIndex >= 0
      ? ['nebula-id', 'role', 'testid', 'aria', 'text', 'css', 'xpath'][strategyIndex]
      : 'unknown';
  }

  private async findFirstMatchingStrategy(locators: string[]): Promise<number> {
    for (let i = 0; i < locators.length; i++) {
      try {
        await this.page!.locator(locators[i]).elementHandle({ timeout: 0 });
        return i;
      } catch {
        continue;
      }
    }
    return -1;
  }

  private buildMarkerActionSuccessResult(
    startTime: number,
    strategy: string,
    attempts: number,
    resolved: ResolvedTarget
  ): MarkerActionResult {
    const parsedNebulaId = resolved.nebulaId ? Number.parseInt(resolved.nebulaId, 10) : undefined;

    return {
      success: true,
      strategy_used: strategy,
      attempts,
      latency_ms: Date.now() - startTime,
      bbox: resolved.bbox,
      nebulaId: typeof parsedNebulaId === 'number' && Number.isFinite(parsedNebulaId)
        ? parsedNebulaId
        : undefined,
      selector: resolved.locators[0],
    };
  }

  async click(x: number, y: number): Promise<void> {
    const page = this.requirePage();
    await page.mouse.click(x, y);
  }

  async clickBySelector(selector: string, options?: ClickOptions): Promise<void> {
    const page = this.requirePage();
    const locator = page.locator(selector);

    if (options?.force) {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          (el as HTMLElement).click();
          return true;
        }
        return false;
      }, selector);
    } else {
      await locator.click({
        button: options?.button,
        clickCount: options?.clickCount,
        delay: options?.delay,
      });
    }
  }

  async clickByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await resolutionService.executeWithFallback(resolved);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async type(selector: string, text: string, options?: TypeOptions): Promise<void> {
    const page = this.requirePage();

    if (options?.force) {
      await page.evaluate(
        ([sel, inputText]) => {
          const el = document.querySelector(sel);
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement ||
            el instanceof HTMLSelectElement
          ) {
            el.value = inputText;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
          return false;
        },
        [selector, text]
      );
    } else {
      if (options?.clear !== false) {
        try {
          await page.fill(selector, '');
        } catch {
          // If fill fails, try using type
        }
      }

      await page.type(selector, text, { delay: options?.delay });
    }
  }

  async typeByMarker(
    snapshotId: string,
    nebulaId: number,
    text: string,
    options?: TypeOptions
  ): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.type(resolved.locators[0], text, options);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async scroll(x: number = 0, y: number = 0): Promise<void> {
    const page = this.requirePage();
    await page.evaluate(
      ([scrollX, scrollY]) => {
        window.scrollBy(scrollX, scrollY);
      },
      [x, y]
    );
  }

  async focus(selector: string): Promise<void> {
    const page = this.requirePage();
    await page.focus(selector);
  }

  async focusByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.focus(resolved.locators[0]);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async blur(selector: string): Promise<void> {
    const page = this.requirePage();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el && typeof (el as HTMLElement).blur === 'function') {
        (el as HTMLElement).blur();
      }
    }, selector);
  }

  async blurByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.blur(resolved.locators[0]);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async hover(selector: string): Promise<void> {
    const page = this.requirePage();
    await page.hover(selector);
  }

  async hoverByMarker(snapshotId: string, nebulaId: number): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.hover(resolved.locators[0]);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async setValue(selector: string, value: string): Promise<void> {
    const page = this.requirePage();
    await page.evaluate(
      ([sel, val]) => {
        const el = document.querySelector(sel);
        if (
          el instanceof HTMLInputElement ||
          el instanceof HTMLTextAreaElement ||
          el instanceof HTMLSelectElement
        ) {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
      [selector, value]
    );
  }

  async setValueByMarker(
    snapshotId: string,
    nebulaId: number,
    value: string
  ): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.setValue(resolved.locators[0], value);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async dispatchEvent(selector: string, eventType: string): Promise<void> {
    const page = this.requirePage();
    await page.evaluate(
      ([sel, type]) => {
        const el = document.querySelector(sel);
        if (el) {
          const event = new Event(type, { bubbles: true });
          el.dispatchEvent(event);
        }
      },
      [selector, eventType]
    );
  }

  async dispatchEventByMarker(
    snapshotId: string,
    nebulaId: number,
    eventType: string
  ): Promise<MarkerActionResult> {
    const page = this.requirePage();
    const startTime = Date.now();

    try {
      const resolutionService = new ClickResolutionService(page);
      const resolved = await resolutionService.resolveTarget({
        snapshot_id: snapshotId,
        nebula_id: nebulaId.toString(),
      });

      const strategy = await this.determineStrategy(resolved.locators, resolved);
      const attempts = resolved.locators.length;

      await this.dispatchEvent(resolved.locators[0], eventType);

      return this.buildMarkerActionSuccessResult(startTime, strategy, attempts, resolved);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        success: false,
        strategy_used: 'none',
        attempts: 0,
        latency_ms: Date.now() - startTime,
        error: {
          code: this.getErrorCode(err.message),
          message: err.message,
        },
      };
    }
  }

  async executeScript(script: string): Promise<unknown> {
    const page = this.requirePage();

    try {
      const result = await page.evaluate((jsCode: string) => {
        try {
          const func = new Function(jsCode);
          return func();
        } catch (e: unknown) {
          const error = e as Error;
          return { error: error.message, stack: error.stack };
        }
      }, script);

      return result;
    } catch (error) {
      throw new Error(`Script execution failed: ${(error as Error).message}`);
    }
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
    const page = this.requirePage();

    const elementInfo = await page.evaluate(
      ([pageX, pageY]) => {
        const el = document.elementFromPoint(pageX, pageY) as HTMLElement | null;
        if (!el) return null;

        const rect = el.getBoundingClientRect();
        const tag = el.tagName.toLowerCase();

        let selector = tag;
        if (el.id) {
          selector = '#' + CSS.escape(el.id);
        } else if (el.getAttribute('name')) {
          selector = `[name="${el.getAttribute('name')}"]`;
        } else if (el.className && typeof el.className === 'string') {
          const classes = el.className.split(' ').filter((c: string) => c && !/^[0-9]/.test(c));
          if (classes.length > 0) {
            selector =
              '.' +
              classes
                .slice(0, 2)
                .map((c: string) => CSS.escape(c))
                .join('.');
          }
        } else if (el.getAttribute('placeholder')) {
          selector = `[placeholder="${el.getAttribute('placeholder')}"]`;
        } else if ((el as HTMLInputElement).type && tag === 'input') {
          selector = `input[type="${(el as HTMLInputElement).type}"]`;
        } else if (el.textContent && tag === 'a') {
          const text = el.textContent.substring(0, 20).replace(/"/g, '\\"');
          selector = `a:has-text("${text}")`;
        }

        const interactableTags = ['a', 'button', 'input', 'textarea', 'select', 'option'];
        const isInteractable =
          interactableTags.includes(tag) ||
          el.onclick !== null ||
          el.getAttribute('role') === 'button';

        return {
          selector,
          tag,
          id: el.id || undefined,
          class: el.className || undefined,
          type: el.getAttribute('type') || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          text: el.textContent?.substring(0, 50) || undefined,
          href: el.getAttribute('href') || undefined,
          src: el.getAttribute('src') || undefined,
          alt: el.getAttribute('alt') || undefined,
          bbox: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
          },
          isVisible: rect.width > 0 && rect.height > 0,
          isInteractable,
        };
      },
      [x, y]
    );

    return elementInfo;
  }
}
