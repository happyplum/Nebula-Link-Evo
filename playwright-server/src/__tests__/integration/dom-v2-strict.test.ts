import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
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

describe.sequential('GET /dom/simplified (v2.0 strict schema validation)', () => {
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

  it('returns v2.0 response with exactly 5 required fields', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;

    // Verify exactly 5 top-level fields exist
    const fieldNames = Object.keys(response);
    expect(fieldNames).toHaveLength(5);
    expect(fieldNames).toContain('snapshot_id');
    expect(fieldNames).toContain('version');
    expect(fieldNames).toContain('annotated_screenshot_base64');
    expect(fieldNames).toContain('elements_map');
    expect(fieldNames).toContain('simplified_dom');

    // Verify no unexpected fields exist
    const expectedFields = ['snapshot_id', 'version', 'annotated_screenshot_base64', 'elements_map', 'simplified_dom'];
    const unexpectedFields = fieldNames.filter((field) => !expectedFields.includes(field));
    expect(unexpectedFields).toHaveLength(0);
  });

  it('version field is exactly "2.0"', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.version).toBe('2.0');
    expect(typeof response.version).toBe('string');
  });

  it('snapshot_id is a non-empty string', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.snapshot_id).toBeTypeOf('string');
    expect(response.snapshot_id.length).toBeGreaterThan(0);
  });

  it('annotated_screenshot_base64 is a non-empty string', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.annotated_screenshot_base64).toBeTypeOf('string');
    expect(response.annotated_screenshot_base64.length).toBeGreaterThan(0);
  });

  it('elements_map is a Record (object), not an Array', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.elements_map).toBeTypeOf('object');
    expect(Array.isArray(response.elements_map)).toBe(false);
    expect(Object.keys(response.elements_map).length).toBeGreaterThan(0);
  });

  it('elements_map values have correct ElementLocatorSchema structure', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    const elementKeys = Object.keys(response.elements_map);
    expect(elementKeys.length).toBeGreaterThan(0);

    // Verify each element has correct structure
    const firstElementKey = elementKeys[0];
    const element = response.elements_map[firstElementKey];

    // Required fields
    expect(element).toHaveProperty('id');
    expect(element.id).toBeTypeOf('string');

    expect(element).toHaveProperty('locator_bundle');
    expect(element.locator_bundle).toBeTypeOf('object');

    expect(element).toHaveProperty('bbox');
    expect(element.bbox).toBeTypeOf('object');

    expect(element).toHaveProperty('tag');
    expect(element.tag).toBeTypeOf('string');

    // Optional fields
    if (element.text !== undefined) {
      expect(element.text).toBeTypeOf('string');
    }

    // Verify bbox structure
    expect(element.bbox).toHaveProperty('x');
    expect(element.bbox.x).toBeTypeOf('number');

    expect(element.bbox).toHaveProperty('y');
    expect(element.bbox.y).toBeTypeOf('number');

    expect(element.bbox).toHaveProperty('width');
    expect(element.bbox.width).toBeTypeOf('number');

    expect(element.bbox).toHaveProperty('height');
    expect(element.bbox.height).toBeTypeOf('number');

    // Verify locator_bundle structure (all optional fields)
    const strategies = ['role', 'testid', 'aria', 'text', 'css', 'xpath'] as const;
    const bundle = element.locator_bundle;

    strategies.forEach((strategy) => {
      if (bundle[strategy] !== undefined) {
        expect(bundle[strategy]).toBeTypeOf('string');
      }
    });

    // At least one strategy should be present
    const strategyCount = strategies.filter((s) => bundle[s] !== undefined).length;
    expect(strategyCount).toBeGreaterThan(0);
  });

  it('simplified_dom has correct structure', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;
    expect(response.simplified_dom).toBeTypeOf('object');

    // Verify viewport structure
    expect(response.simplified_dom).toHaveProperty('viewport');
    expect(response.simplified_dom.viewport).toBeTypeOf('object');
    expect(response.simplified_dom.viewport).toHaveProperty('width');
    expect(response.simplified_dom.viewport.width).toBeTypeOf('number');
    expect(response.simplified_dom.viewport).toHaveProperty('height');
    expect(response.simplified_dom.viewport.height).toBeTypeOf('number');

    // Verify elements structure
    expect(response.simplified_dom).toHaveProperty('elements');
    expect(Array.isArray(response.simplified_dom.elements)).toBe(true);
    expect(response.simplified_dom.elements.length).toBeGreaterThan(0);
  });

  it('rejects v1.0 format - no "elements" array at top level', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;

    // v1.0 format had "elements" array at top level
    // v2.0 should NOT have this
    expect(response).not.toHaveProperty('elements');
  });

  it('rejects v1.0 format - no "success" or "error" fields', async () => {
    await ensureBrowserReady();

    const { status, json } = await requestJson(baseUrl, '/dom/simplified');
    expect(status).toBe(200);
    expect(json).not.toBeNull();

    const response = json as Record<string, any>;

    // v1.0 format had "success" boolean and "error" string
    // v2.0 should NOT have these
    expect(response).not.toHaveProperty('success');
    expect(response).not.toHaveProperty('error');
  });
});
