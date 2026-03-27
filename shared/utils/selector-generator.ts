/**
 * Selector Generator Utility
 *
 * Generates Playwright locator bundles from element information.
 * Provides robust selector strategies for element identification.
 */

import type { LocatorBundle } from '../types/vision-marker.js';

/**
 * Element information for generating locators.
 */
interface ElementInfo {
  /** HTML tag name (e.g., 'button', 'input', 'div') */
  tagName: string;
  /** Optional HTML attributes */
  attributes?: Record<string, string>;
  /** Optional text content */
  textContent?: string;
  /** Optional bounding box position */
  bbox?: {
    x: number;
    y: number;
  };
}

/**
 * Generates a locator bundle from element information.
 *
 * @param elementInfo - Information about the target element
 * @returns A locator bundle with multiple selector strategies
 *
 * @example
 * ```ts
 * const elementInfo = {
 *   tagName: 'button',
 *   attributes: { 'data-testid': 'submit' },
 *   textContent: 'Submit'
 * };
 * const locators = generateLocatorBundle(elementInfo);
 * ```
 */
export function generateLocatorBundle(
  elementInfo: ElementInfo
): LocatorBundle {
  const result: LocatorBundle = {};
  const { tagName, attributes, textContent } = elementInfo;

  // Strategy 1: testid selector (confidence: 1.0 - highest)
  // Explicit test identifier is most stable
  if (attributes?.['data-testid']) {
    result.testid = attributes['data-testid'];
  }

  // Strategy 2: role selector (confidence: 0.9 - high)
  // Semantic meaning provides stability
  if (tagName) {
    result.role = tagName;
  }

  // Strategy 3: aria selector (confidence: 0.8 - high)
  // Accessibility attributes provide good stability
  const ariaLabel = attributes?.['aria-label'];
  if (ariaLabel) {
    result.aria = ariaLabel;
  }

  // Strategy 4: text selector (confidence: 0.6 - medium)
  // May change with localization
  if (textContent && textContent.trim().length > 0) {
    result.text = textContent.trim();
  }

  // Strategy 5: css selector (confidence: 0.4 - low)
  // May change with styling updates
  if (attributes?.['class']) {
    result.css = attributes['class'];
  }

  // Strategy 6: xpath selector (confidence: 0.2 - lowest)
  // Brittle, use as fallback only
  if (tagName) {
    result.xpath = generateXPath(elementInfo);
  }

  return result;
}

/**
 * Generates an absolute XPath for an element.
 * Used as a fallback when other selectors are unavailable.
 *
 * @param elementInfo - Element information
 * @returns Absolute XPath string
 */
function generateXPath(elementInfo: ElementInfo): string {
  const { tagName, attributes } = elementInfo;
  
  // Start with tag name
  let xpath = `//${tagName}`;
  
  // Add id attribute if present (most stable XPath)
  if (attributes?.['id']) {
    xpath += `[@id='${attributes['id']}']`;
    return xpath;
  }
  
  // Add class attributes for better specificity
  if (attributes?.['class']) {
    const classes = attributes['class'].trim().split(/\s+/).filter(c => c);
    if (classes.length > 0) {
      xpath += `[contains(concat(' ',normalize-space(@class),' '),' ${classes[0]} ')]`;
    }
  }
  
  return xpath;
}
