import { Page } from 'playwright';
import { RELEVANT_ELEMENT_ATTRS } from './dom-utils.js';

/**
 * Element information extracted from the page during marker injection.
 */
interface InjectedElementInfo {
  /** Unique data-nebula-id assigned to the element */
  id: string;
  /** HTML tag name */
  tag: string;
  /** Text content of the element (truncated) */
  text?: string;
  /** Element attributes (id, class, href, etc.) */
  attributes: Record<string, string>;
  /** Bounding box coordinates on the page */
  bbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Result of marker injection into the page.
 */
export interface MarkerInjectionResult {
  /** Total number of interactive elements found */
  elementCount: number;
  /** Array of element information with assigned IDs */
  elements: InjectedElementInfo[];
}

/**
 * Generates a self-contained JavaScript script that injects markers into interactive elements.
 *
 * The script:
 * - Finds all interactive elements using CSS selectors
 * - Assigns unique data-nebula-id attributes (starting from "1")
 * - Creates visual red badges overlaying each element
 * - Returns element information including bounding boxes and attributes
 * - Cleans up visual markers after data extraction
 *
 * @returns JavaScript code as a string to execute via page.evaluate()
 */
export function generateMarkerInjectionScript(): string {
  return `(() => {
    const elementsMap = new Map();
    const markerElements = [];

    // CSS selectors for interactive elements in priority order
    const selectors = [
      'button, [role="button"]',
      'a[href]',
      'input:not([type]), input[type="text"], input[type="email"], input[type="password"], input[type="search"], input[type="url"], input[type="tel"], input[type="number"]',
      'input[type="submit"], input[type="button"], input[type="checkbox"], input[type="radio"], input[type="file"]',
      'textarea',
      'select',
      '[role="link"], [role="menuitem"], [role="tab"]',
      '[onclick]',
      '[tabindex="0"]'
    ];

    // Find all elements matching selectors
    const allElements = [];
    selectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!allElements.includes(el)) {
            allElements.push(el);
          }
        });
      } catch (e) {
        // Ignore invalid selectors
      }
    });

    // Filter visible elements
    const visibleElements = Array.from(allElements).filter(el => {
      const htmlEl = el;
      const rect = htmlEl.getBoundingClientRect();
      const style = window.getComputedStyle(htmlEl);

      // Check if element is visible
      const hasSize = rect.width > 0 && rect.height > 0;
      const isInViewport = rect.top >= -rect.height && rect.left >= -rect.width;
      const isDisplayed = style.display !== 'none';
      const isVisible = style.visibility !== 'hidden';
      const isOpaque = style.opacity !== '0';

      return hasSize && isInViewport && isDisplayed && isVisible && isOpaque;
    });

    // Assign IDs and create markers
    // Assign IDs and create markers
    visibleElements.forEach((el, index) => {
      const markerId = String(index + 1);
      const htmlEl = el;

      // Set data-nebula-id attribute
      el.setAttribute('data-nebula-id', markerId);

      // Get element information
      const rect = htmlEl.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().substring(0, 100) || '';

      // Collect relevant attributes (list from shared dom-utils)
      const attributes = {};
      const relevantAttrs = [${RELEVANT_ELEMENT_ATTRS.map(a => `'${a}'`).join(', ')}];
      relevantAttrs.forEach(attr => {
        const value = el.getAttribute(attr);
        if (value) {
          attributes[attr] = value;
        }
      });
      // Store element information
      elementsMap.set(markerId, {
        id: markerId,
        tag: tag,
        text: text || undefined,
        attributes: attributes,
        bbox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });

      // Create visual marker
      const marker = document.createElement('div');
      marker.textContent = markerId;
      marker.style.cssText = \`
        position: absolute;
        z-index: 2147483647;
        width: 20px;
        height: 20px;
        background-color: #ff0000;
        color: #ffffff;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: Arial, sans-serif;
        font-size: 12px;
        font-weight: bold;
        box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);
        pointer-events: none;
      \`;

      // Position marker at top-left corner of element
      marker.style.left = \`\${rect.left}px\`;
      marker.style.top = \`\${rect.top}px\`;

      // Add marker to document
      document.body.appendChild(marker);
      markerElements.push(marker);
    });

    // Get viewport dimensions
    const viewport = {
      width: window.innerWidth,
      height: window.innerHeight
    };

    // Return the result
    const result = {
      elementCount: visibleElements.length,
      elements: Array.from(elementsMap.values())
    };

    // Clean up markers after data extraction (wait a bit to allow screenshot)
    setTimeout(() => {
      markerElements.forEach(marker => {
        marker.remove();
      });
    }, 100);

    return result;
  })();`;
}

/**
 * Injects markers into interactive elements on a Playwright page.
 *
 * This function executes the marker injection script in the browser context,
 * which assigns unique data-nebula-id attributes to all interactive elements
 * and creates visual markers overlaying them.
 *
 * The visual markers are automatically cleaned up after data extraction,
 * but the data-nebula-id attributes remain on the elements.
 *
 * @param page - Playwright Page object
 * @returns Promise<MarkerInjectionResult> Element information with assigned IDs
 * @throws Error if script execution fails
 */
export async function injectMarkers(page: Page): Promise<MarkerInjectionResult> {
  try {
    const script = generateMarkerInjectionScript();
    const result = await page.evaluate(script) as MarkerInjectionResult;
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Marker injection failed: ${message}`);
  }
}
