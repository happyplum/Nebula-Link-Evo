import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import {
  generateMarkerInjectionScript,
  injectMarkers,
} from '../marker-injector.js';

describe('marker-injector', () => {
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

  describe('generateMarkerInjectionScript', () => {
    it('should return a string containing valid JavaScript', () => {
      const script = generateMarkerInjectionScript();
      
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
      // Should be an IIFE
      expect(script).toMatch(/^\(\(\) => \{/);
      expect(script).toMatch(/\}\)\(\);$/);
    });

    it('should contain CSS selectors for interactive elements', () => {
      const script = generateMarkerInjectionScript();
      
      // Button selectors
      expect(script).toContain('button, [role="button"]');
      // Link selectors
      expect(script).toContain('a[href]');
      // Input selectors
      expect(script).toContain('input[type="text"]');
      expect(script).toContain('input[type="email"]');
      expect(script).toContain('input[type="password"]');
      expect(script).toContain('input[type="search"]');
      expect(script).toContain('input[type="submit"]');
      expect(script).toContain('input[type="button"]');
      // Other form elements
      expect(script).toContain('textarea');
      expect(script).toContain('select');
      // Role-based selectors
      expect(script).toContain('[role="link"]');
      expect(script).toContain('[role="menuitem"]');
      expect(script).toContain('[role="tab"]');
      // Event and tabindex selectors
      expect(script).toContain('[onclick]');
      expect(script).toContain('[tabindex="0"]');
    });

    it('should assign data-nebula-id attributes', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain('data-nebula-id');
      expect(script).toContain('setAttribute');
    });

    it('should create visual markers with correct styling', () => {
      const script = generateMarkerInjectionScript();
      
      // Position
      expect(script).toContain('position: absolute');
      // Z-index (max safe integer)
      expect(script).toContain('z-index: 2147483647');
      // Size
      expect(script).toContain('width: 20px');
      expect(script).toContain('height: 20px');
      // Color
      expect(script).toContain('background-color: #ff0000');
      expect(script).toContain('color: #ffffff');
      // Border radius (circular)
      expect(script).toContain('border-radius: 50%');
      // Flexbox centering
      expect(script).toContain('display: flex');
      expect(script).toContain('align-items: center');
      expect(script).toContain('justify-content: center');
      // Pointer events none to avoid blocking clicks
      expect(script).toContain('pointer-events: none');
    });

    it('should collect element attributes (id, class, name, type, placeholder, href, src, alt, role, aria-label)', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain("'id'");
      expect(script).toContain("'class'");
      expect(script).toContain("'name'");
      expect(script).toContain("'type'");
      expect(script).toContain("'placeholder'");
      expect(script).toContain("'href'");
      expect(script).toContain("'src'");
      expect(script).toContain("'alt'");
      expect(script).toContain("'role'");
      expect(script).toContain("'aria-label'");
    });

    it('should include cleanup logic with setTimeout', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain('setTimeout');
      expect(script).toContain('marker.remove()');
      // Cleanup should happen after 100ms
      expect(script).toContain('100');
    });

    it('should assign unique IDs starting from "1"', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain('String(index + 1)');
    });

    it('should truncate text content to 100 characters', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain('substring(0, 100)');
    });

    it('should round bounding box coordinates', () => {
      const script = generateMarkerInjectionScript();
      
      expect(script).toContain('Math.round(rect.left)');
      expect(script).toContain('Math.round(rect.top)');
      expect(script).toContain('Math.round(rect.width)');
      expect(script).toContain('Math.round(rect.height)');
    });
  });

  describe('injectMarkers', () => {
    it('should successfully inject markers into a page with interactive elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="btn1">Click Me</button>
            <a href="https://example.com">Link</a>
            <input type="text" name="search" placeholder="Search..." />
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(3);
      expect(result.elements.length).toBe(3);
    });

    it('should return correct element count', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>Button 1</button>
            <button>Button 2</button>
            <a href="/link">Link</a>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(3);
    });

    it('should return elements array with correct structure (id, tag, text, attributes, bbox)', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="submit-btn" class="btn primary" aria-label="Submit">Submit</button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elements.length).toBe(1);
      const element = result.elements[0];
      
      expect(element.id).toBeDefined();
      expect(element.tag).toBe('button');
      expect(element.text).toBeDefined();
      expect(element.attributes).toBeDefined();
      expect(element.bbox).toBeDefined();
      expect(element.bbox.x).toBeDefined();
      expect(element.bbox.y).toBeDefined();
      expect(element.bbox.width).toBeDefined();
      expect(element.bbox.height).toBeDefined();
    });

    it('should assign unique IDs starting from "1"', async () => {
      await page.setContent(`
        <html>
          <body>
            <button>First</button>
            <button>Second</button>
            <button>Third</button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elements[0].id).toBe('1');
      expect(result.elements[1].id).toBe('2');
      expect(result.elements[2].id).toBe('3');
    });

    it('should correctly calculate bounding boxes', async () => {
      await page.setContent(`
        <html>
          <body style="margin: 0; padding: 0;">
            <button id="btn" style="position: absolute; left: 50px; top: 100px; width: 200px; height: 40px;">Button</button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);
      const button = result.elements.find(el => el.attributes.id === 'btn');

      expect(button).toBeDefined();
      // Accept exact position or small variance
      expect(button!.bbox.x).toBe(50);
      expect(button!.bbox.y).toBe(100);
      expect(button!.bbox.width).toBe(200);
      expect(button!.bbox.height).toBe(40);
    });

    it('should filter out invisible elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="visible">Visible</button>
            <button id="hidden" style="display: none;">Hidden</button>
            <button id="invisible" style="visibility: hidden;">Invisible</button>
            <button id="transparent" style="opacity: 0;">Transparent</button>
            <button id="zero-size" style="width: 0; height: 0;">Zero Size</button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      // Only the visible button should be counted (zero-size may also be filtered)
      expect(result.elementCount).toBeGreaterThanOrEqual(1);
      expect(result.elements.find(el => el.attributes.id === 'visible')).toBeDefined();
      expect(result.elements.find(el => el.attributes.id === 'hidden')).toBeUndefined();
      expect(result.elements.find(el => el.attributes.id === 'invisible')).toBeUndefined();
      expect(result.elements.find(el => el.attributes.id === 'transparent')).toBeUndefined();
    });

    it('should handle pages with no interactive elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <div>Just text</div>
            <span>More text</span>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(0);
      expect(result.elements).toEqual([]);
    });

    it('should collect element attributes correctly', async () => {
      await page.setContent(`
        <html>
          <body>
            <a id="link" class="nav-link" href="https://example.com" aria-label="Go to example">Example Link</a>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);
      const link = result.elements[0];

      expect(link.attributes.id).toBe('link');
      expect(link.attributes.class).toBe('nav-link');
      expect(link.attributes.href).toBe('https://example.com');
      expect(link.attributes['aria-label']).toBe('Go to example');
    });

    it('should truncate long text content', async () => {
      const longText = 'A'.repeat(200);
      await page.setContent(`
        <html>
          <body>
            <button>${longText}</button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elements[0].text?.length).toBe(100);
    });

    it('should handle elements with special characters in attributes', async () => {
      await page.setContent(`
        <html>
          <body>
            <input name="email[]" placeholder="Enter your email..." type="text" />
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(1);
      expect(result.elements[0].attributes.name).toBe('email[]');
      expect(result.elements[0].attributes.placeholder).toBe('Enter your email...');
    });

    it('should handle nested interactive elements by including both', async () => {
      await page.setContent(`
        <html>
          <body>
            <button onclick="alert('outer')">
              <span>Button Text</span>
            </button>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      // Button is interactive, span inside button is not separately counted
      expect(result.elementCount).toBe(1);
      expect(result.elements[0].tag).toBe('button');
    });

    it('should handle elements with onclick attribute', async () => {
      await page.setContent(`
        <html>
          <body>
            <div onclick="doSomething()">Clickable Div</div>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(1);
      expect(result.elements[0].tag).toBe('div');
    });

    it('should handle elements with tabindex="0"', async () => {
      await page.setContent(`
        <html>
          <body>
            <div tabindex="0">Focusable Div</div>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(1);
      expect(result.elements[0].tag).toBe('div');
    });

    it('should handle select elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <select name="options">
              <option value="1">Option 1</option>
              <option value="2">Option 2</option>
            </select>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(1);
      expect(result.elements[0].tag).toBe('select');
    });

    it('should handle textarea elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <textarea name="comment" placeholder="Enter comment..."></textarea>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(1);
      expect(result.elements[0].tag).toBe('textarea');
    });

    it('should handle role-based interactive elements', async () => {
      await page.setContent(`
        <html>
          <body>
            <div role="button">Role Button</div>
            <div role="link">Role Link</div>
            <div role="menuitem">Menu Item</div>
            <div role="tab">Tab</div>
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(4);
    });

    it('should handle input submit and button types', async () => {
      await page.setContent(`
        <html>
          <body>
            <input type="submit" value="Submit" />
            <input type="button" value="Click" />
          </body>
        </html>
      `);

      const result = await injectMarkers(page);

      expect(result.elementCount).toBe(2);
    });

    it('should throw error with descriptive message when page.evaluate fails', async () => {
      // Create a page and then close it to cause an error
      const closedPage = await browser.newPage();
      await closedPage.close();

      await expect(injectMarkers(closedPage)).rejects.toThrow('Marker injection failed');
    });

    it('should assign data-nebula-id attribute to elements in DOM', async () => {
      await page.setContent(`
        <html>
          <body>
            <button id="btn1">Button 1</button>
            <button id="btn2">Button 2</button>
          </body>
        </html>
      `);

      await injectMarkers(page);

      // Verify data-nebula-id attributes were assigned
      const btn1Id = await page.$eval('#btn1', el => el.getAttribute('data-nebula-id'));
      const btn2Id = await page.$eval('#btn2', el => el.getAttribute('data-nebula-id'));

      expect(btn1Id).toBe('1');
      expect(btn2Id).toBe('2');
    });
  });
});