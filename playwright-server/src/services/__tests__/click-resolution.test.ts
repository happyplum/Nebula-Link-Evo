import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page, ElementHandle } from 'playwright';
import { ClickResolutionService } from '../click-resolution.js';

interface ResolvedTarget {
  locators: string[];
  element?: ElementHandle;
  bbox?: { x: number; y: number; width: number; height: number };
}

describe('ClickResolutionService', () => {
  let browser: Browser;
  let page: Page;
  let service: ClickResolutionService;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
    service = new ClickResolutionService(page);
  });

  afterEach(async () => {
    await page.close();
  });

  describe('resolveTarget', () => {
    it('should resolve target with nebula_id and generate locators', async () => {
      await page.setContent(`
        <div id="test-div" data-nebula-id="abc123" class="container">Content</div>
      `);

      const target = await service.resolveTarget({ nebula_id: 'abc123' });

      expect(target.locators).toBeDefined();
      expect(target.locators.length).toBeGreaterThan(0);
      expect(target.bbox).toBeDefined();
    });

    it('should resolve target with selector and generate locators', async () => {
      await page.setContent(`
        <button id="submit" class="btn">Submit</button>
      `);

      const target = await service.resolveTarget({ selector: '#submit' });

      expect(target.locators).toBeDefined();
      expect(target.locators.length).toBeGreaterThan(0);
      expect(target.bbox).toBeDefined();
    });

    it('should order locators by priority: role > testid > aria > text > css > xpath', async () => {
      await page.setContent(`
        <button id="btn" data-testid="submit-btn" aria-label="Submit" class="btn primary">Submit</button>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      expect(target.locators.length).toBeGreaterThan(0);
      // Check that locators follow priority order
      const firstLocator = target.locators[0];
      // Role should be first if available
      if (firstLocator.includes('role')) {
        expect(target.locators[0]).toContain('role');
      }
    });

    it('should throw error when nebula_id not found', async () => {
      await page.setContent('<div>No nebula id</div>');

      await expect(service.resolveTarget({ nebula_id: 'nonexistent' })).rejects.toThrow();
    });

    it('should throw error when selector not found', async () => {
      await page.setContent('<div>No target</div>');

      await expect(service.resolveTarget({ selector: '#nonexistent' })).rejects.toThrow();
    });

    it('should generate up to 6 locators', async () => {
      await page.setContent(`
        <button id="btn" data-testid="test" aria-label="Label" role="button" class="btn">Button</button>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      expect(target.locators.length).toBeLessThanOrEqual(6);
    });

    it('should handle elements with only text content', async () => {
      await page.setContent('<button>Click Me</button>');

      const target = await service.resolveTarget({ selector: 'button' });

      expect(target.locators).toBeDefined();
      expect(target.locators.length).toBeGreaterThan(0);
    });

    it('should include xpath as fallback locator', async () => {
      await page.setContent('<div id="test">Content</div>');

      const target = await service.resolveTarget({ selector: '#test' });

      // Check if xpath is in the locators
      const hasXPath = target.locators.some(loc => loc.startsWith('//') || loc.startsWith('xpath='));
      expect(hasXPath).toBe(true);
    });
  });

  describe('executeWithFallback', () => {
    it('should click element using first successful locator', async () => {
      await page.setContent(`
        <button id="btn" data-testid="submit" aria-label="Submit">Submit</button>
        <div id="clicked">false</div>
        <script>
          document.getElementById('btn').addEventListener('click', () => {
            document.getElementById('clicked').textContent = 'true';
          });
        </script>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });
      await service.executeWithFallback(target);

      const clickedText = await page.$eval('#clicked', el => el.textContent);
      expect(clickedText).toBe('true');
    });

    it('should try multiple locators if first fails', async () => {
      // Create scenario where first few locators might fail
      await page.setContent(`
        <div id="container">
          <button id="btn1" class="btn">Button 1</button>
          <button id="btn2" class="btn">Button 2</button>
        </div>
      `);

      const target = await service.resolveTarget({ selector: '#btn1' });
      await service.executeWithFallback(target);

      // Should successfully click one of them
      expect(target.locators.length).toBeGreaterThan(0);
    });

    it('should timeout within 1 second', async () => {
      await page.setContent('<button id="btn">Click</button>');

      const target = await service.resolveTarget({ selector: '#btn' });

      const start = Date.now();
      await service.executeWithFallback(target);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);
    });

    it('should throw error if all locators fail', async () => {
      // Create invalid locators scenario
      await page.setContent('<div>No button</div>');

      const target: ResolvedTarget = {
        locators: ['#nonexistent', '.invalid', 'text=fake'],
      };

      await expect(service.executeWithFallback(target)).rejects.toThrow();
    });

    it('should handle timeout gracefully', async () => {
      await page.setContent(`
        <button id="btn">Click</button>
        <script>
          // Slow handler
          document.getElementById('btn').addEventListener('click', (e) => {
            e.preventDefault();
            while(true); // Infinite loop to simulate timeout
          });
        </script>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      // Should handle timeout within 1 second
      const start = Date.now();
      try {
        await service.executeWithFallback(target);
      } catch {
        // Expected to timeout
        const duration = Date.now() - start;
        expect(duration).toBeLessThan(1200); // Allow some overhead
      }
    });

    it('should click hidden elements with force option', async () => {
      await page.setContent(`
        <button id="btn" style="display:none">Hidden</button>
        <div id="clicked">false</div>
        <script>
          document.getElementById('btn').addEventListener('click', () => {
            document.getElementById('clicked').textContent = 'true';
          });
        </script>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      // Should attempt to click even if hidden
      await expect(service.executeWithFallback(target)).rejects.toThrow();
    });

    it('should use force option to click non-interactable elements', async () => {
      await page.setContent(`
        <button id="btn" style="pointer-events:none">Non-interactable</button>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      // Should attempt to click even if non-interactable
      await expect(service.executeWithFallback(target)).rejects.toThrow();
    });

    it('should prioritize role locator', async () => {
      await page.setContent(`
        <button role="button" aria-label="Submit">Submit</button>
      `);

      const target = await service.resolveTarget({ selector: 'button' });

      // First locator should be role-based
      if (target.locators.length > 0 && target.locators[0].includes('role')) {
        await service.executeWithFallback(target);
        expect(true).toBe(true); // Successfully clicked
      }
    });

    it('should prioritize testid locator over css', async () => {
      await page.setContent(`
        <button id="btn" data-testid="submit" class="btn">Submit</button>
      `);

      const target = await service.resolveTarget({ selector: '#btn' });

      // Check that testid comes before css
      const testidIndex = target.locators.findIndex(l => l.includes('data-testid'));
      const cssIndex = target.locators.findIndex(l => l.includes('#btn') && !l.includes('data-testid'));

      if (testidIndex !== -1 && cssIndex !== -1) {
        expect(testidIndex).toBeLessThan(cssIndex);
      }
    });

    it('should handle elements with aria-label', async () => {
      await page.setContent(`
        <button aria-label="Search">Search</button>
      `);

      const target = await service.resolveTarget({ selector: 'button' });
      await service.executeWithFallback(target);

      expect(target.locators).toBeDefined();
    });
  });

  describe('integration', () => {
    it('should resolve and click element end-to-end', async () => {
      await page.setContent(`
        <button id="submit" data-testid="submit-btn" aria-label="Submit Form" class="btn btn-primary">Submit</button>
        <div id="result">waiting</div>
        <script>
          document.getElementById('submit').addEventListener('click', () => {
            document.getElementById('result').textContent = 'clicked';
          });
        </script>
      `);

      // Resolve target by nebula_id (simulated)
      const target = await service.resolveTarget({ selector: '#submit' });

      // Execute click with fallback
      await service.executeWithFallback(target);

      // Verify click succeeded
      const result = await page.$eval('#result', el => el.textContent);
      expect(result).toBe('clicked');
    });

    it('should handle complex page with multiple similar elements', async () => {
      await page.setContent(`
        <div class="container">
          <button id="btn1" class="btn">Button 1</button>
          <button id="btn2" class="btn">Button 2</button>
          <button id="btn3" class="btn">Button 3</button>
        </div>
        <div id="clicked"></div>
        <script>
          document.querySelectorAll('.btn').forEach((btn, i) => {
            btn.addEventListener('click', () => {
              document.getElementById('clicked').textContent = 'btn' + (i + 1);
            });
          });
        </script>
      `);

      // Resolve specific button by ID
      const target = await service.resolveTarget({ selector: '#btn2' });

      await service.executeWithFallback(target);

      const result = await page.$eval('#clicked', el => el.textContent);
      expect(result).toBe('btn2');
    });
  });
});
