import { Page, ElementHandle } from 'playwright';
import type { LocatorBundle } from '../../shared/types/vision-marker.js';
import { createWorkerLogger } from './services/logger.js';

const logger = createWorkerLogger('LocatorGenerator');

/**
 * Generate multiple locator strategies for an element in priority order.
 * Returns the best available locators with role > testid > aria > text > css > xpath.
 *
 * @param element - Playwright ElementHandle to generate locators for
 * @returns Promise<LocatorBundle> object with multiple selector strategies
 */
export async function generateLocatorBundle(
  element: ElementHandle
): Promise<LocatorBundle> {
  const bundle: LocatorBundle = {};

  try {
    const attributes = await getElementAttributes(element);
    const tagName = await element.evaluate((el) => {
      if (el instanceof Element) {
        return el.tagName.toLowerCase();
      }
      return '';
    });

    // Role locator (highest priority)
    const role = attributes['role'] || getImplicitRole(tagName);
    const accessibleName =
      attributes['aria-label'] ||
      attributes['aria-labelledby'] ||
      attributes['title'] ||
      attributes['name'];

    if (role && accessibleName) {
      bundle.role = `[role="${role}"][name="${accessibleName}"]`;
    } else if (role) {
      bundle.role = `[role="${role}"]`;
    }

    // Test ID locator (data-testid attribute)
    if (attributes['data-testid']) {
      bundle.testid = `[data-testid="${escapeSelector(attributes['data-testid'])}"]`;
    }

    // ARIA label locator
    if (attributes['aria-label']) {
      bundle.aria = `[aria-label="${escapeSelector(attributes['aria-label'])}"]`;
    } else if (attributes['aria-describedby']) {
      bundle.aria = `[aria-describedby="${escapeSelector(attributes['aria-describedby'])}"]`;
    }

    // Text locator (exact text match)
    const text = await element.evaluate((el) => el.textContent?.trim());
    if (text && text.length > 0 && text.length < 100) {
      bundle.text = `text=${escapeSelector(text)}`;
    }

    // CSS class selector
    const cssSelector = await generateCssSelector(element);
    if (cssSelector) {
      bundle.css = cssSelector;
    }

    // XPath locator (fallback)
    const xpath = await generateXPath(element);
    if (xpath) {
      bundle.xpath = xpath;
    }
  } catch (error) {
    // Silently handle errors - return empty bundle on failure
    logger.warn({ err: error }, 'Failed to generate locator bundle');
  }

  return bundle;
}

/**
 * Generate the single best stable selector for an element.
 * Returns the first available selector in priority order.
 *
 * @param element - Playwright ElementHandle to generate selector for
 * @returns Promise<string> the best available selector
 */
export async function generateStableSelector(
  element: ElementHandle
): Promise<string> {
  try {
    const bundle = await generateLocatorBundle(element);

    // Priority: role > testid > aria > text > css > xpath
    if (bundle.role) {
      return bundle.role;
    }

    if (bundle.testid) {
      return bundle.testid;
    }

    if (bundle.aria) {
      return bundle.aria;
    }

    if (bundle.text) {
      return bundle.text;
    }

    if (bundle.css) {
      return bundle.css;
    }

    if (bundle.xpath) {
      return `xpath=${bundle.xpath}`;
    }
  } catch (error) {
    logger.warn({ err: error }, 'Failed to generate stable selector');
  }

  // Fallback: use a basic tag selector
  const tagName = await element
    .evaluate((el) => {
      if (el instanceof Element) {
        return el.tagName.toLowerCase();
      }
      return '';
    })
    .catch(() => '*');
  return tagName;
}

/**
 * Check if a selector is unique on the page.
 *
 * @param page - Playwright Page object
 * @param selector - CSS selector to check
 * @returns Promise<boolean> true if selector matches exactly one element
 */
export async function isUniqueSelector(
  page: Page,
  selector: string
): Promise<boolean> {
  try {
    const count = await page.locator(selector).count();
    return count === 1;
  } catch {
    return false;
  }
}

/**
 * Generate a unique CSS selector for an element.
 * Prefers ID > name > data-testid > class combinations > structural selectors.
 *
 * @param element - Playwright ElementHandle to generate CSS selector for
 * @returns Promise<string> CSS selector string, empty if unavailable
 */
export async function generateCssSelector(
  element: ElementHandle
): Promise<string> {
  try {
    const attributes = await getElementAttributes(element);
    const tagName = await element.evaluate((el) => {
      if (el instanceof Element) {
        return el.tagName.toLowerCase();
      }
      return '';
    });

    // Try ID first (most stable)
    if (attributes.id) {
      const escapedId = escapeSelector(attributes.id);
      return `${tagName}#${escapedId}`;
    }

    // Try name attribute (stable for forms)
    if (attributes.name) {
      const escapedName = escapeSelector(attributes.name);
      return `${tagName}[name="${escapedName}"]`;
    }

    // Try type attribute for inputs
    if (attributes.type && tagName === 'input') {
      const escapedType = escapeSelector(attributes.type);
      const selector = `${tagName}[type="${escapedType}"]`;
      return selector;
    }

    // Try placeholder attribute
    if (attributes.placeholder) {
      const escapedPlaceholder = escapeSelector(attributes.placeholder);
      return `${tagName}[placeholder="${escapedPlaceholder}"]`;
    }

    // Try class selector (use first 1-2 stable classes)
    if (attributes.class && typeof attributes.class === 'string') {
      const classes = attributes.class
        .split(/\s+/)
        .filter(
          (c) =>
            c &&
            c.length > 0 &&
            !/^(hover|active|focus|visited|link|first|last|odd|even)/i.test(c) &&
            !/^[0-9]/.test(c) &&
            !c.includes(':')
        )
        .slice(0, 2);

      if (classes.length > 0) {
        const escapedClasses = classes.map(escapeSelector).join('.');
        return `${tagName}.${escapedClasses}`;
      }
    }

    // Fallback: use nth-child structural selector
    const nthChild = await element.evaluate((el) => {
      if (!(el instanceof Element)) {
        return 1;
      }
      let index = 1;
      let sibling = el.previousElementSibling;
      while (sibling) {
        index++;
        sibling = sibling.previousElementSibling;
      }
      return index;
    });

    return `${tagName}:nth-child(${nthChild})`;
  } catch {
    return '';
  }
}

/**
 * Generate an XPath selector for an element.
 * Uses absolute path with tag names and attributes for stability.
 *
 * @param element - Playwright ElementHandle to generate XPath for
 * @returns Promise<string> XPath selector string, empty if unavailable
 */
export async function generateXPath(element: ElementHandle): Promise<string> {
  try {
    const attributes = await getElementAttributes(element);
    const tagName = await element.evaluate((el) => {
      if (el instanceof Element) {
        return el.tagName.toLowerCase();
      }
      return '';
    });

    // Build XPath with attribute filters for uniqueness
    let xpath = `//${tagName}`;

    const attrFilters: string[] = [];

    // Add ID attribute
    if (attributes.id) {
      attrFilters.push(`@id='${escapeXPath(attributes.id)}'`);
    }

    // Add name attribute
    if (attributes.name) {
      attrFilters.push(`@name='${escapeXPath(attributes.name)}'`);
    }

    // Add data-testid attribute
    if (attributes['data-testid']) {
      attrFilters.push(
        `@data-testid='${escapeXPath(attributes['data-testid'])}'`
      );
    }

    // Add type attribute for inputs
    if (attributes.type && tagName === 'input') {
      attrFilters.push(`@type='${escapeXPath(attributes.type)}'`);
    }

    // Add class attribute (use first class if available)
    if (attributes.class && typeof attributes.class === 'string') {
      const firstClass = attributes.class.split(/\s+/)[0];
      if (firstClass) {
        attrFilters.push(`contains(@class, '${escapeXPath(firstClass)}')`);
      }
    }

    // Add text content filter for non-empty text
    const text = await element.evaluate((el) => el.textContent?.trim());
    if (text && text.length > 0 && text.length < 50) {
      attrFilters.push(`text()='${escapeXPath(text)}'`);
    }

    // Combine attribute filters
    if (attrFilters.length > 0) {
      xpath += `[${attrFilters.join(' and ')}]`;
    }

    return xpath;
  } catch {
    return '';
  }
}

/**
 * Extract all attributes from an element as a key-value record.
 *
 * @param element - Playwright ElementHandle to extract attributes from
 * @returns Promise<Record<string, string>> object with all attributes
 */
export async function getElementAttributes(
  element: ElementHandle
): Promise<Record<string, string>> {
  try {
    return await element.evaluate((el) => {
      if (!(el instanceof Element)) {
        return {};
      }
      const attrs: Record<string, string> = {};
      if (el.hasAttributes()) {
        for (let i = 0; i < el.attributes.length; i++) {
          const attr = el.attributes[i];
          attrs[attr.name] = attr.value;
        }
      }
      return attrs;
    });
  } catch {
    return {};
  }
}

/**
 * Escape special characters in CSS selectors.
 *
 * @param selector - Selector string to escape
 * @returns Escaped selector string
 */
function escapeSelector(selector: string): string {
  return selector.replace(
    new RegExp('([!"#$%&\'()*+,.\\/:;<=>?@[\\]^`{|}~])', 'g'),
    '\\$1'
  );
}

/**
 * Escape special characters in XPath values.
 *
 * @param value - Value string to escape
 * @returns Escaped value string
 */
function escapeXPath(value: string): string {
  return value.replace(/'/g, "\\'");
}

/**
 * Get implicit ARIA role for common HTML elements.
 *
 * @param tagName - HTML tag name in lowercase
 * @returns Implicit role name or undefined
 */
function getImplicitRole(tagName: string): string | undefined {
  const implicitRoles: Record<string, string> = {
    a: 'link',
    button: 'button',
    input: 'textbox',
    textarea: 'textbox',
    select: 'combobox',
    option: 'option',
    h1: 'heading',
    h2: 'heading',
    h3: 'heading',
    h4: 'heading',
    h5: 'heading',
    h6: 'heading',
    img: 'img',
    nav: 'navigation',
    header: 'banner',
    footer: 'contentinfo',
    main: 'main',
    aside: 'complementary',
    article: 'article',
    section: 'region',
    ul: 'list',
    ol: 'list',
    li: 'listitem',
    table: 'table',
    thead: 'rowgroup',
    tbody: 'rowgroup',
    tr: 'row',
    th: 'columnheader',
    td: 'cell',
  };

  return implicitRoles[tagName];
}
