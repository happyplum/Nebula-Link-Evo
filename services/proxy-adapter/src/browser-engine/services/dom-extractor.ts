import { Page } from 'playwright';
import * as crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import type {
  BoundingBox,
  DOMSnapshotResponse,
  ElementLocator,
  SimplifiedDOM,
  SimplifiedElement,
} from '@nebula-link-evo/shared';
import { generateLocatorBundle } from '../locator-generator.js';
import { injectMarkers } from '../marker-injector.js';
import { createWorkerLogger, type Logger } from '../../services/logger.js';

export class DOMExtractor {
  private page: Page | null = null;
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('DOMExtractor');
  }

  setPage(page: Page | null): void {
    this.page = page;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('Browser not opened');
    return this.page;
  }

  private async takeAnnotatedScreenshot(): Promise<Buffer> {
    const page = this.requirePage();
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: false,
    });
    return screenshot;
  }

  async getSimplifiedDOMV2(): Promise<DOMSnapshotResponse> {
    const page = this.requirePage();

    try {
      const snapshot_id = crypto.randomUUID();

      // Inject markers and get element information
      const markerResult = await injectMarkers(page);
      const { elements } = markerResult;

      // Take screenshot with marker overlay at 70% quality
      const screenshotBuffer = await this.takeAnnotatedScreenshot();

      // Gzip compress the screenshot and convert to base64
      const compressedScreenshot = gzipSync(screenshotBuffer);
      const annotated_screenshot_base64 = compressedScreenshot.toString('base64');

      // Build elements map with multi-strategy locators
      const elements_map: Record<string, ElementLocator> = {};
      const simplified_elements: SimplifiedElement[] = [];

      for (const elementInfo of elements) {
        try {
          // Get element handle by data-nebula-id attribute
          const elementHandle = await page.waitForSelector(`[data-nebula-id="${elementInfo.id}"]`, {
            timeout: 1000,
          });

          if (elementHandle) {
            // Generate multi-strategy locators
            const locator_bundle = await generateLocatorBundle(elementHandle);

            const elementLocator: ElementLocator = {
              id: elementInfo.id,
              locator_bundle: locator_bundle,
              bbox: elementInfo.bbox as BoundingBox,
              tag: elementInfo.tag,
              text: elementInfo.text,
            };

            elements_map[elementInfo.id] = elementLocator;

            // Add to simplified DOM elements
            const simplifiedElement: SimplifiedElement = {
              tag: elementInfo.tag,
              id: elementInfo.id,
              class: elementInfo.attributes.class,
              text: elementInfo.text,
              attributes: elementInfo.attributes,
            };

            simplified_elements.push(simplifiedElement);

            await elementHandle.dispose();
          }
        } catch (error) {
          this.logger.warn({ err: error, elementId: elementInfo.id }, 'Failed to process element');
        }
      }

      // Build simplified DOM structure
      const viewport = page.viewportSize() || { width: 1920, height: 1080 };
      const simplified_dom: SimplifiedDOM = {
        elements: simplified_elements,
        viewport,
      };

      const snapshotResponse: DOMSnapshotResponse = {
        snapshot_id,
        version: '2.0',
        annotated_screenshot_base64,
        elements_map,
        simplified_dom,
      };

      return snapshotResponse;
    } catch (error) {
      this.logger.error({ err: error }, 'getSimplifiedDOMV2 failed');
      throw error;
    }
  }
}
