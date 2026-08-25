/**
 * Shared DOM utility operations for the in-process browser engine.
 *
 * Centralises element attribute extraction, tag-name helpers, text-content
 * retrieval, selector escaping, and ARIA role mapping so that marker-injector,
 * locator-generator, and other service modules can reuse the same logic.
 *
 * Migrated from playwright-server/src/dom-utils.ts.
 */

import type { ElementHandle } from 'playwright';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Attributes considered relevant for interactive-element identification.
 * Used by marker-injector (embedded in browser script) and consumer modules
 * that need to filter a full attribute map down to actionable fields.
 */
export const RELEVANT_ELEMENT_ATTRS: readonly string[] = [
  'id',
  'class',
  'name',
  'type',
  'placeholder',
  'href',
  'src',
  'alt',
  'role',
  'aria-label',
] as const;

// ---------------------------------------------------------------------------
// Selector escaping
// ---------------------------------------------------------------------------

/**
 * Escape special characters in CSS selectors.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(new RegExp('([!"#$%&\'()*+,.\\/:;<=>?@[\\]^`{|}~])', 'g'), '\\$1');
}

/**
 * Escape special characters in XPath values.
 */
export function escapeXPath(value: string): string {
  return value.replace(/'/g, "\\'");
}

// ---------------------------------------------------------------------------
// Element attribute extraction
// ---------------------------------------------------------------------------

/**
 * Extract all attributes from an element as a key-value record.
 *
 * Runs inside the browser context via `element.evaluate()`.
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
 * Filter a full attribute map down to only the relevant element attributes.
 */
export function filterRelevantAttributes(allAttrs: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const attr of RELEVANT_ELEMENT_ATTRS) {
    if (allAttrs[attr]) {
      filtered[attr] = allAttrs[attr];
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Element property helpers
// ---------------------------------------------------------------------------

/**
 * Get the lowercased tag name of an element.
 */
export async function getElementTagName(element: ElementHandle): Promise<string> {
  try {
    return await element.evaluate((el) => {
      if (el instanceof Element) {
        return el.tagName.toLowerCase();
      }
      return '';
    });
  } catch {
    return '';
  }
}

/**
 * Get trimmed text content from an element, optionally truncated.
 */
export async function getElementText(element: ElementHandle, maxLength?: number): Promise<string> {
  try {
    const text = await element.evaluate((el) => el.textContent?.trim() || '');
    return maxLength ? text.substring(0, maxLength) : text;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// ARIA helpers
// ---------------------------------------------------------------------------

/**
 * Implicit ARIA role mapping for common HTML elements.
 */
export function getImplicitRole(tagName: string): string | undefined {
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
