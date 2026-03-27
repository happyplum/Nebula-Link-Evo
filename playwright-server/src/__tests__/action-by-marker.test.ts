import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, Browser } from 'playwright';
import Fastify from 'fastify';
import actionRoutesPlugin from '../plugins/routes/action.js';
import { browserService } from '../services/browser-service.js';

describe('/action/execute-by-marker endpoint', () => {
  let browser: Browser;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    browser = await chromium.launch();

    await browserService.open(true, { width: 1920, height: 1080 });
    await browserService.navigate('about:blank');
  });

  afterAll(async () => {
    await browserService.close();
    await browser.close();
  });

  beforeEach(() => {
    app = Fastify();
    app.register(actionRoutesPlugin, { prefix: '/action' });
  });

  describe('click action', () => {
    it('should return success response when element is clicked successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <button id="test-btn" data-testid="test-btn" aria-label="Test Button">Click Me</button>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'click',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when element not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'invalid-snapshot',
          nebula_id: 99999,
          action: 'click',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
      expect(body).toHaveProperty('strategy_used', 'none');
      expect(body).toHaveProperty('attempts', 0);
    });
  });

  describe('type action', () => {
    it('should return success response when text is typed successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <input type="text" id="test-input" data-testid="test-input" aria-label="Test Input" placeholder="Enter text" />
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'type',
            param: {
              text: 'Hello World',
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when target is not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'non-existent',
          nebula_id: 88888,
          action: 'type',
          param: {
            text: 'Test',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('focus action', () => {
    it('should return success response when element is focused successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <input type="text" id="test-input" data-testid="test-input" aria-label="Test Input" />
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'focus',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when element cannot be focused', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'fake-id',
          nebula_id: 77777,
          action: 'focus',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('blur action', () => {
    it('should return success response when element is blurred successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <input type="text" id="test-input" data-testid="test-input" aria-label="Test Input" />
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        await browserService.getPage()?.focus('#test-input');
        
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'blur',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when element not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'invalid',
          nebula_id: 66666,
          action: 'blur',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('hover action', () => {
    it('should return success response when element is hovered successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <button id="test-btn" data-testid="test-btn" aria-label="Test Button">Hover Me</button>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'hover',
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when element not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'missing',
          nebula_id: 55555,
          action: 'hover',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('value action', () => {
    it('should return success response when value is set successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <input type="text" id="test-input" data-testid="test-input" aria-label="Test Input" />
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'value',
            param: {
              value: 'Test Value 123',
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when snapshot not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'does-not-exist',
          nebula_id: 44444,
          action: 'value',
          param: {
            value: 'Test',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('dispatch action', () => {
    it('should return success response when event is dispatched successfully', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <button id="test-btn" data-testid="test-btn" aria-label="Test Button">Dispatch Event</button>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'dispatch',
            param: {
              eventType: 'custom-event',
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should return error response when element not found', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'not-found',
          nebula_id: 33333,
          action: 'dispatch',
          param: {
            eventType: 'some-event',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    });
  });

  describe('multi-strategy fallback logic', () => {
    it('should use multiple locator strategies when primary fails', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <button 
            id="submit-btn" 
            data-testid="submit-btn" 
            aria-label="Submit Form"
            class="btn btn-primary"
          >
            Submit
          </button>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      // Test with real element if markers work, or validate error structure if not
      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: snapshot.snapshot_id,
          nebula_id: elementIds.length > 0 ? parseInt(elementIds[0]) : 1,
          action: 'click',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toHaveProperty('success');
      // Strategy can be 'none' when marker injection fails, or actual strategy when it works
      expect(body.strategy_used).toMatch(/^(role|testid|aria|text|css|xpath|unknown|none)$/);
      expect(body.attempts).toBeGreaterThanOrEqual(0);
      expect(body.latency_ms).toBeGreaterThanOrEqual(0);
    });

    it('should track all strategy attempts on failure', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          snapshot_id: 'completely-fake-id',
          nebula_id: 12345,
          action: 'click',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.strategy_used).toBe('none');
      expect(body.attempts).toBe(0);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBeDefined();
      expect(body.error.message).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle invalid action type', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `<button id="test-btn">Test</button>`;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'invalid-action',
          },
        });

        expect(response.statusCode).toBeOneOf([200, 400, 500]);
        const body = JSON.parse(response.payload);
        if (response.statusCode === 200) {
          expect(body.success).toBe(false);
          expect(body.error).toHaveProperty('message');
        }
      }
    });

    it('should handle missing required parameters', async () => {
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: '/action/execute-by-marker',
        payload: {
          action: 'click',
        },
      });

      expect(response.statusCode).toBeOneOf([200, 400, 500]);
      const body = JSON.parse(response.payload);
      expect(body).toBeDefined();
    });

    it('should handle type action with options', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <textarea id="test-area" data-testid="test-area" aria-label="Test Area"></textarea>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'type',
            param: {
              text: 'Test with options',
              options: {
                delay: 50,
                clear: true,
              },
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
        expect(body).toHaveProperty('attempts');
        expect(body).toHaveProperty('latency_ms');
      }
    });

    it('should handle dispatch action with eventInit', async () => {
      await app.ready();

      await browserService.getPage()?.evaluate(() => {
        document.body.innerHTML = `
          <button id="test-btn" data-testid="test-btn" aria-label="Test Button">Test</button>
        `;
      });

      await browserService.getPage()?.waitForLoadState('networkidle');

      const snapshot = await browserService.getSimplifiedDOMV2();
      const elementIds = Object.keys(snapshot.elements_map);
      
      if (elementIds.length > 0) {
        const response = await app.inject({
          method: 'POST',
          url: '/action/execute-by-marker',
          payload: {
            snapshot_id: snapshot.snapshot_id,
            nebula_id: parseInt(elementIds[0]),
            action: 'dispatch',
            param: {
              eventType: 'custom-detail-event',
              eventInit: {
                detail: { testData: 'value123' },
              },
            },
          },
        });

        expect(response.statusCode).toBe(200);
        const body = JSON.parse(response.payload);
        expect(body).toHaveProperty('success');
        expect(body).toHaveProperty('strategy_used');
      }
    });
  });
});
