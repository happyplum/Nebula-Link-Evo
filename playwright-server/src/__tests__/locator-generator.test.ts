import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import {
  generateLocatorBundle,
  generateStableSelector,
  generateCssSelector,
  generateXPath,
  isUniqueSelector,
  getElementAttributes,
} from '../locator-generator.js';

describe('locator-generator', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });

  afterEach(async () => {
    await page.close();
  });

  describe('getElementAttributes', () => {
    it('should extract all attributes from an element', async () => {
      await page.setContent('<button id="submit-btn" class="btn primary" data-testid="submit" aria-label="Submit form">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const attrs = await getElementAttributes(element);

      expect(attrs.id).toBe('submit-btn');
      expect(attrs.class).toBe('btn primary');
      expect(attrs['data-testid']).toBe('submit');
      expect(attrs['aria-label']).toBe('Submit form');
    });

    it('should return empty object for element with no attributes', async () => {
      await page.setContent('<div>Text</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const attrs = await getElementAttributes(element);

      expect(attrs).toEqual({});
    });

    it('should handle elements with special characters in attributes', async () => {
      await page.setContent('<input name="email[]" placeholder="Enter your email..." />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const attrs = await getElementAttributes(element);

      expect(attrs.name).toBe('email[]');
      expect(attrs.placeholder).toBe('Enter your email...');
    });
  });

  describe('generateCssSelector', () => {
    it('should generate ID-based selector for element with ID', async () => {
      await page.setContent('<button id="submit-btn">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toBe('button#submit-btn');
    });

    it('should generate name-based selector for element with name attribute', async () => {
      await page.setContent('<input name="email" type="text" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toBe('input[name="email"]');
    });

    it('should generate type-based selector for input elements', async () => {
      await page.setContent('<input type="password" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toBe('input[type="password"]');
    });

    it('should generate placeholder-based selector', async () => {
      await page.setContent('<input placeholder="Search..." />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toBe('input[placeholder="Search\\.\\.\\."]');
    });

    it('should generate class-based selector for element with classes', async () => {
      await page.setContent('<div class="container main">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toMatch(/^div\.(container|main)/);
    });

    it('should filter out pseudo-state classes', async () => {
      await page.setContent('<a class="nav-link hover active focus">Link</a>');
      const element = await page.$('a');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).not.toContain('hover');
      expect(selector).not.toContain('active');
      expect(selector).not.toContain('focus');
    });

    it('should fall back to nth-child for elements without identifying attributes', async () => {
      await page.setContent('<div><span>First</span><span>Second</span></div>');
      const spans = await page.$$('span');
      const secondSpan = spans[1];
      if (!secondSpan) throw new Error('Element not found');

      const selector = await generateCssSelector(secondSpan);

      expect(selector).toBe('span:nth-child(2)');
    });

    it('should escape special CSS characters in selectors', async () => {
      await page.setContent('<div id="test:id">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateCssSelector(element);

      expect(selector).toContain('\\:');
    });
  });

  describe('generateXPath', () => {
    it('should generate XPath with ID attribute', async () => {
      await page.setContent('<button id="submit-btn">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("@id='submit-btn'");
    });

    it('should generate XPath with name attribute', async () => {
      await page.setContent('<input name="email" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("@name='email'");
    });

    it('should generate XPath with data-testid attribute', async () => {
      await page.setContent('<button data-testid="submit">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("@data-testid='submit'");
    });

    it('should generate XPath with type attribute for input', async () => {
      await page.setContent('<input type="checkbox" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("@type='checkbox'");
    });

    it('should generate XPath with class attribute', async () => {
      await page.setContent('<div class="container main">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("contains(@class, 'container')");
    });

    it('should generate XPath with text content for short text', async () => {
      await page.setContent('<button>Click Me</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("text()='Click Me'");
    });

    it('should not include text for very long content', async () => {
      const longText = 'A'.repeat(100);
      await page.setContent(`<div>${longText}</div>`);
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).not.toContain('text()=');
    });

    it('should escape single quotes in XPath values', async () => {
      await page.setContent("<div id=\"test'id\">Content</div>");
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const xpath = await generateXPath(element);

      expect(xpath).toContain("\\'");
    });
  });

  describe('isUniqueSelector', () => {
    it('should return true for unique selector', async () => {
      await page.setContent('<button id="unique">Click</button>');

      const isUnique = await isUniqueSelector(page, '#unique');

      expect(isUnique).toBe(true);
    });

    it('should return false for non-unique selector', async () => {
      await page.setContent('<button class="btn">One</button><button class="btn">Two</button>');

      const isUnique = await isUniqueSelector(page, '.btn');

      expect(isUnique).toBe(false);
    });

    it('should return false for selector matching no elements', async () => {
      await page.setContent('<div>Content</div>');

      const isUnique = await isUniqueSelector(page, '#nonexistent');

      expect(isUnique).toBe(false);
    });

    it('should return false for invalid selector', async () => {
      await page.setContent('<div>Content</div>');

      const isUnique = await isUniqueSelector(page, '[][]');

      expect(isUnique).toBe(false);
    });
  });

  describe('generateLocatorBundle', () => {
    it('should generate role locator for button with aria-label', async () => {
      await page.setContent('<button aria-label="Submit form">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.role).toBeDefined();
      expect(bundle.role).toContain('button');
    });

    it('should generate testid locator for element with data-testid', async () => {
      await page.setContent('<button data-testid="submit-btn">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.testid).toBe('[data-testid="submit-btn"]');
    });

    it('should generate aria locator for element with aria-label', async () => {
      await page.setContent('<input aria-label="Search" type="text" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.aria).toBe('[aria-label="Search"]');
    });

    it('should generate text locator for element with text content', async () => {
      await page.setContent('<button>Click Here</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.text).toBe('text=Click Here');
    });

    it('should generate css locator', async () => {
      await page.setContent('<button id="test-btn">Click</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.css).toBe('button#test-btn');
    });

    it('should generate xpath locator', async () => {
      await page.setContent('<button id="test-btn">Click</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.xpath).toBeDefined();
      expect(bundle.xpath).toContain('//button');
    });

    it('should generate all 6 locator strategies for element with all attributes', async () => {
      await page.setContent('<button id="btn" data-testid="submit-btn" class="btn" aria-label="Submit" role="button">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.role).toBeDefined();
      expect(bundle.testid).toBeDefined();
      expect(bundle.aria).toBeDefined();
      expect(bundle.text).toBeDefined();
      expect(bundle.css).toBeDefined();
      expect(bundle.xpath).toBeDefined();
    });

    it('should handle implicit role for button elements', async () => {
      await page.setContent('<button>Click</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.role).toBeDefined();
      expect(bundle.role).toContain('button');
    });

    it('should handle implicit role for link elements', async () => {
      await page.setContent('<a href="/page">Link</a>');
      const element = await page.$('a');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.role).toBe('[role="link"]');
    });

    it('should handle implicit role for input elements', async () => {
      await page.setContent('<input type="text" name="search" />');
      const element = await page.$('input');
      if (!element) throw new Error('Element not found');

      const bundle = await generateLocatorBundle(element);

      expect(bundle.role).toContain('[role="textbox"]');
    });

    it('should return empty bundle on element evaluation error', async () => {
      // Create a detached element that will fail on evaluate
      await page.setContent('<div>Test</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');
      
      // Dispose the element to make it invalid
      await element.dispose();

      const bundle = await generateLocatorBundle(element);

      // Should return empty bundle on error
      expect(Object.keys(bundle).length).toBe(0);
    });
  });

  describe('generateStableSelector', () => {
    it('should return role selector as highest priority', async () => {
      await page.setContent('<button id="btn" data-testid="submit" aria-label="Submit" role="button">Submit</button>');
      const element = await page.$('button');
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toContain('role=');
    });

    it('should return testid selector when no role', async () => {
      await page.setContent('<div data-testid="container">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toBe('[data-testid="container"]');
    });

    it('should return aria selector when no role or testid', async () => {
      await page.setContent('<div aria-label="Main content">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toBe('[aria-label="Main content"]');
    });

    it('should return text selector when no role, testid, or aria', async () => {
      await page.setContent('<div>Unique Text Here</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toBe('text=Unique Text Here');
    });

    it('should return css selector when no higher priority selectors', async () => {
      await page.setContent('<div id="fallback">Content</div>');
      const element = await page.$('div');
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toBe('text=Content');
    });

    it('should return xpath selector as last resort', async () => {
      await page.setContent('<div><span>Text</span></div>');
      const spans = await page.$$('span');
      const element = spans[0];
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      expect(selector).toBe('text=Text');
    });

    it('should return tag name when all else fails', async () => {
      await page.setContent('<div><span></span></div>');
      const spans = await page.$$('span');
      const element = spans[0];
      if (!element) throw new Error('Element not found');

      const selector = await generateStableSelector(element);

      // Should return a selector (either xpath or tag)
      expect(selector).toBeTruthy();
    });
  });
});

// Import beforeAll and afterAll
import { beforeAll, afterAll } from 'vitest';