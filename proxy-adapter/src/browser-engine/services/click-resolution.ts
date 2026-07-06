import { Page, ElementHandle } from 'playwright';
import { generateLocatorBundle } from '../locator-generator.js';

interface ClickTarget {
  snapshot_id?: string;
  nebula_id?: string;
  selector?: string;
}

export interface ResolvedTarget {
  locators: string[];
  element?: ElementHandle;
  nebulaId?: string;
  bbox?: { x: number; y: number; width: number; height: number };
}

export class ClickResolutionService {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Resolve target from nebula_id or selector to locators array.
   * Priority: nebula-id > role > testid > aria > text > css > xpath
   */
  async resolveTarget(target: ClickTarget): Promise<ResolvedTarget> {
    let element: ElementHandle | null = null;
    let nebulaId: string | undefined;

    try {
      if (target.nebula_id) {
        nebulaId = target.nebula_id;
        element = await this.page.locator(`[data-nebula-id="${target.nebula_id}"]`).elementHandle({ timeout: 1000 });
      } else if (target.selector) {
        element = await this.page.locator(target.selector).elementHandle({ timeout: 1000 });
      }
    } catch {
      // Element not found or timeout
    }

    if (!element) {
      throw new Error(`Element not found: ${JSON.stringify(target)}`);
    }

    const bundle = await generateLocatorBundle(element);
    const locators = this.buildLocatorArray(bundle, nebulaId);

    const bbox = await element.boundingBox();
    // Hidden elements may not have bounding box - allow this case
    return {
      locators,
      element,
      nebulaId,
      bbox: bbox || undefined,
    };
  }
  /**
   * Build locator array in priority order: nebula-id > role > testid > aria > text > css > xpath
   */
  private buildLocatorArray(bundle: { role?: string; testid?: string; aria?: string; text?: string; css?: string; xpath?: string }, nebulaId?: string): string[] {
    const locators: string[] = [];

    // Always prefer data-nebula-id locator for precision
    if (nebulaId) {
      locators.push(`[data-nebula-id="${nebulaId}"]`);
    }
    if (bundle.role) locators.push(bundle.role);
    if (bundle.testid) locators.push(bundle.testid);
    if (bundle.aria) locators.push(bundle.aria);
    if (bundle.text) locators.push(bundle.text);
    if (bundle.css) locators.push(bundle.css);
    if (bundle.xpath) locators.push(`xpath=${bundle.xpath}`);

    return locators;
  }

  /**
   * Execute click with fallback to multiple locators.
   * Tries locators in order with timeout < 1s total.
   */
  async executeWithFallback(target: ResolvedTarget): Promise<void> {
    const maxAttempts = Math.min(target.locators.length, 6);
    const timeoutPerAttempt = Math.floor(1000 / maxAttempts);

    let lastError: Error | null = null;

    for (let i = 0; i < maxAttempts; i++) {
      const locator = target.locators[i];
      try {
        await this.page.locator(locator).click({
          timeout: timeoutPerAttempt,
          force: false,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next locator
      }
    }

    throw new Error(`All ${maxAttempts} locators failed. Last error: ${lastError?.message}`);
  }
}
