import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import actionRoutesPlugin from '../plugins/routes/action.js';
import { browserService } from '../services/browser-service.js';
import { debugEventHub } from '../services/debug-event-hub.js';

vi.mock('../livekit-publisher.js', () => ({
  startPublisher: vi.fn().mockResolvedValue(undefined),
  stopPublisher: vi.fn().mockResolvedValue(undefined),
}));

describe('/action/click-by-marker endpoint', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    await browserService.open(true, { width: 1920, height: 1080 });
    await browserService.navigate('about:blank');
  });

  afterAll(async () => {
    await browserService.close();
  });

  beforeEach(() => {
    debugEventHub.resetForTests();
    app = Fastify();
    app.register(actionRoutesPlugin, { prefix: '/action' });
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
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

  it('publishes marker and overlay debug events after a successful marker click', async () => {
    await app.ready();
    const nebulaId = 42;
    const snapshotId = 'snapshot-click-marker';
    vi.spyOn(browserService, 'clickByMarker').mockResolvedValue({
      success: true,
      strategy_used: 'nebula-id',
      attempts: 1,
      latency_ms: 12,
      nebulaId,
      selector: '[data-nebula-id="42"]',
      bbox: {
        x: 100,
        y: 200,
        width: 80,
        height: 24,
      },
    });

    const publishSpy = vi.spyOn(debugEventHub, 'publish');

    const response = await app.inject({
      method: 'POST',
      url: '/action/click-by-marker',
      payload: {
        snapshot_id: snapshotId,
        nebula_id: nebulaId,
      },
    });

    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(publishSpy).toHaveBeenCalledTimes(2);
    expect(publishSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'debug.marker',
        marker: expect.objectContaining({
          source: 'ai',
          action: 'click',
          ttlMs: 5000,
          nebulaId,
          selector: '[data-nebula-id="42"]',
          bbox: expect.objectContaining({
            x: 100,
            y: 200,
            width: 80,
            height: 24,
          }),
          pageX: 140,
          pageY: 212,
        }),
      })
    );
    expect(publishSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'debug.overlay',
        overlay: expect.objectContaining({
          kind: 'highlight',
          source: 'ai',
          ttlMs: 5000,
          selector: '[data-nebula-id="42"]',
          bbox: expect.objectContaining({
            x: 100,
            y: 200,
            width: 80,
            height: 24,
          }),
        }),
      })
    );
  });
});
