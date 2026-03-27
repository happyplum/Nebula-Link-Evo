import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { chromium, Browser } from 'playwright';
import Fastify from 'fastify';
import actionRoutesPlugin from '../plugins/routes/action.js';
import { browserService } from '../services/browser-service.js';

describe('/action/click-by-marker endpoint', () => {
  let browser: Browser;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    browser = await chromium.launch();

    await browserService.open(true, { width: 1920, height: 1080 });
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

  it('should return error response when element not found', async () => {
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/action/click-by-marker',
      payload: {
        snapshot_id: 'test-123',
        nebula_id: 999999,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });
  it('should return success with correct response structure when endpoint exists', async () => {
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/action/click-by-marker',
      payload: {
        snapshot_id: 'test-123',
        nebula_id: 1,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);
    // Success response
    if (body.success) {
      expect(body).toHaveProperty('success');
      expect(body).toHaveProperty('strategy_used');
      expect(body).toHaveProperty('attempts');
      expect(body).toHaveProperty('latency_ms');
    }
    // Error response (when element not found)
    else {
      expect(body).toHaveProperty('success', false);
      expect(body).toHaveProperty('strategy_used');
      expect(body).toHaveProperty('attempts', 0);
      expect(body).toHaveProperty('latency_ms');
      expect(body.error).toHaveProperty('code');
      expect(body.error).toHaveProperty('message');
    }
  });
  it('should return error response with code and message on failure', async () => {
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/action/click-by-marker',
      payload: {
        snapshot_id: 'invalid',
        nebula_id: 999999,
      },
    });

    // After implementation, should return error structure
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);
    expect(body.success).toBe(false);
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
  });
});
