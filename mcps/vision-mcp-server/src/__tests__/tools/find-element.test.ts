import { describe, it, expect, vi } from 'vitest';
import type { ToolDeps } from '../../types.js';
import type { VisionConfig } from '../../config.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { registerFindElementTool } from '../../tools/find-element.js';

function createMockDeps(): ToolDeps {
  return {
    playwrightClient: {
      getSimplifiedDOM: vi.fn(),
      getScreenshot: vi.fn(),
      getBrowserStatus: vi.fn(),
    } as any,
    visionAnalyzer: {
      findElement: vi.fn(),
    } as any,
    cache: {
      get: vi.fn(),
      set: vi.fn(),
      latest: vi.fn(),
      clear: vi.fn(),
    } as any,
  };
}

function createMockServer() {
  const tools: Array<{ name: string; handler: (...args: any[]) => any }> = [];
  return {
    registerTool: vi.fn((name: string, _config: any, handler: any) => {
      tools.push({ name, handler });
    }),
    tools,
  };
}

const mockConfig: VisionConfig = {
  PLAYWRIGHT_SERVER_URL: 'http://localhost:3001',
  VISION_PROVIDER_BASE_URL: 'https://api.example.com',
  VISION_PROVIDER_API_KEY: 'test-key',
  VISION_MODEL_ID: 'test-model',
  VISION_MAX_TOKENS: 2048,
  VISION_TEMPERATURE: 0.1,
  VISION_TIMEOUT_MS: 30000,
  VISION_MAX_RETRIES: 2,
};

function makeSnapshot(overrides?: Partial<DOMSnapshotResponse>): DOMSnapshotResponse {
  return {
    snapshot_id: 'snap-001',
    version: '2.0',
    annotated_screenshot_base64: 'base64jpegdata==',
    elements_map: {
      '42': {
        id: '42',
        tag: 'button',
        text: 'Login',
        bbox: { x: 120, y: 456, width: 80, height: 32 },
        locator_bundle: { role: 'button', text: 'Login', css: '#login-btn' },
      },
    },
    simplified_dom: {
      viewport: { width: 1280, height: 720 },
      elements: [],
    },
    ...overrides,
  };
}

describe('find_element tool', () => {
  it('should register with name "find_element"', () => {
    const server = createMockServer();
    const deps = createMockDeps();
    registerFindElementTool(server as any, deps, mockConfig);
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('find_element');
  });

  it('should use cached snapshot when snapshot_id is provided and cached', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(snapshot);
    (deps.visionAnalyzer.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({
      nebula_id: '42',
      confidence: 0.95,
      reasoning: 'Found login button',
    });

    registerFindElementTool(server as any, deps, mockConfig);
    const result = await server.tools[0].handler({
      description: 'the login button',
      snapshot_id: 'snap-001',
    });

    expect(deps.cache.get).toHaveBeenCalledWith('snap-001');
    expect(deps.playwrightClient.getSimplifiedDOM).not.toHaveBeenCalled();
    expect(deps.visionAnalyzer.findElement).toHaveBeenCalledWith(
      snapshot,
      'the login button',
      mockConfig
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nebula_id).toBe('42');
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.element).toEqual({
      tag: 'button',
      text: 'Login',
      bbox: { x: 120, y: 456, width: 80, height: 32 },
    });
  });

  it('should fetch fresh snapshot when snapshot_id not cached', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockResolvedValue(
      snapshot
    );
    (deps.visionAnalyzer.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({
      nebula_id: '42',
      confidence: 0.9,
      reasoning: 'Matched',
    });

    registerFindElementTool(server as any, deps, mockConfig);
    const result = await server.tools[0].handler({
      description: 'submit button',
      snapshot_id: 'snap-001',
    });

    expect(deps.playwrightClient.getSimplifiedDOM).toHaveBeenCalledOnce();
    expect(deps.cache.set).toHaveBeenCalledWith('snap-001', snapshot);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nebula_id).toBe('42');
  });

  it('should return no-match when nebula_id is null', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(snapshot);
    (deps.visionAnalyzer.findElement as ReturnType<typeof vi.fn>).mockResolvedValue({
      nebula_id: null,
      confidence: 0,
      reasoning: 'No element matching description found',
    });

    registerFindElementTool(server as any, deps, mockConfig);
    const result = await server.tools[0].handler({
      description: 'nonexistent element',
      snapshot_id: 'snap-001',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nebula_id).toBeNull();
    expect(parsed.confidence).toBe(0);
    expect(parsed.snapshot_id).toBe('snap-001');
  });

  it('should handle errors', async () => {
    const server = createMockServer();
    const deps = createMockDeps();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection failed')
    );

    registerFindElementTool(server as any, deps, mockConfig);
    const result = await server.tools[0].handler({
      description: 'something',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error: Connection failed');
  });
});
