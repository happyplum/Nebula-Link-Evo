import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { gunzipSync } from 'node:zlib';
import browserRoutesPlugin from '../../plugins/routes/browser.js';
import domRoutesPlugin from '../../plugins/routes/dom.js';

type JsonValue = Record<string, unknown> | null;

async function requestJson(
  baseUrl: string,
  path: string,
  options: { method?: string; body?: Record<string, unknown> } = {}
): Promise<{ status: number; json: JsonValue }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let json: JsonValue = null;
  try {
    json = (await response.json()) as JsonValue;
  } catch {
    json = null;
  }

  return { status: response.status, json };
}

describe.sequential('GET /dom/simplified (integration)', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let browserReady = false;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(browserRoutesPlugin, { prefix: '/browser' });
    await app.register(domRoutesPlugin, { prefix: '/dom' });
    await app.listen({ port: 0, host: '127.0.0.1' });

    const address = app.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve Fastify listen address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await requestJson(baseUrl, '/browser/close', { method: 'POST' });
    await app.close();
  });

  async function ensureBrowserReady() {
    if (browserReady) {
      return;
    }

    const openResponse = await requestJson(baseUrl, '/browser/open', {
      method: 'POST',
      body: { headless: true, viewport: { width: 1280, height: 720 } },
    });
    expect(openResponse.status).toBe(200);

    const navigateResponse = await requestJson(baseUrl, '/browser/navigate', {
      method: 'POST',
      body: { url: 'about:blank', waitUntil: 'domcontentloaded' },
    });
    expect(navigateResponse.status).toBe(200);

    const scriptResponse = await requestJson(baseUrl, '/dom/script', {
      method: 'POST',
      body: {
        script: `document.body.innerHTML = '\
          <button id="test-btn" data-testid="submit-btn" aria-label="Submit">Click</button>\
          <a href="/docs">Docs</a>\
          <input type="text" name="query" placeholder="Search" />';`,
      },
    });
    expect(scriptResponse.status).toBe(200);

    browserReady = true;
  }

  it('returns 503 when browser is not open', async () => {
    await requestJson(baseUrl, '/browser/close', { method: 'POST' });
    browserReady = false;

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');

    expect(status).toBe(503);
    expect(json).toMatchObject({
      success: false,
      error: 'Browser is not open',
    });
  });


  it('returns v2.0 response with required fields and valid gzip screenshot', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.snapshot_id).toBeTypeOf('string');
    expect(response.version).toBe('2.0');
    expect(response.annotated_screenshot_base64).toBeTypeOf('string');
    expect(response.annotated_screenshot_base64.length).toBeGreaterThan(0);
    expect(response.elements_map).toBeTypeOf('object');
    expect(response.simplified_dom).toBeTypeOf('object');

    const compressed = Buffer.from(response.annotated_screenshot_base64, 'base64');
    expect(() => gunzipSync(compressed)).not.toThrow();
    const decompressed = gunzipSync(compressed);
    expect(decompressed.length).toBeGreaterThan(0);

    const elements = Object.values(response.elements_map) as Array<Record<string, any>>;
    expect(elements.length).toBeGreaterThan(0);

    const elementWithBundle = elements.find((entry) => entry.locator_bundle);
    expect(elementWithBundle).toBeDefined();

    const bundle = elementWithBundle?.locator_bundle ?? {};
    const strategies = ['role', 'testid', 'aria', 'text', 'css', 'xpath'] as const;
    const strategyCount = strategies.filter((strategy) => bundle[strategy]).length;
    expect(strategyCount).toBeGreaterThan(0);

    expect(elementWithBundle).toMatchObject({
      id: expect.any(String),
      bbox: {
        x: expect.any(Number),
        y: expect.any(Number),
        width: expect.any(Number),
        height: expect.any(Number),
      },
      tag: expect.any(String),
    });

    expect(response.simplified_dom.elements.length).toBeGreaterThan(0);
    expect(response.simplified_dom.viewport.width).toBeTypeOf('number');
    expect(response.simplified_dom.viewport.height).toBeTypeOf('number');
  });


});
