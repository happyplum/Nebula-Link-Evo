import { describe, it, expect, vi } from 'vitest';
import type { ToolDeps } from '../../types.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { registerAnalyzeTool } from '../../tools/analyze.js';

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

function makeSnapshot(overrides?: Partial<DOMSnapshotResponse>): DOMSnapshotResponse {
  return {
    snapshot_id: 'snap-001',
    version: '2.0',
    annotated_screenshot_base64: 'base64jpegdata==',
    elements_map: {
      '1': {
        id: '1',
        tag: 'button',
        text: 'Login',
        bbox: { x: 10, y: 20, width: 80, height: 30 },
        locator_bundle: { role: 'button', text: 'Login' },
      },
      '2': {
        id: '2',
        tag: 'input',
        bbox: { x: 10, y: 60, width: 200, height: 24 },
        locator_bundle: { css: '#search' },
      },
    },
    simplified_dom: {
      viewport: { width: 1280, height: 720 },
      elements: [],
    },
    ...overrides,
  };
}

describe('analyze tool', () => {
  it('should register with name "analyze"', () => {
    const server = createMockServer();
    const deps = createMockDeps();
    registerAnalyzeTool(server as any, deps);
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('analyze');
  });

  it('should return text summary and annotated image', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockResolvedValue(
      snapshot
    );

    registerAnalyzeTool(server as any, deps);
    const result = await server.tools[0].handler({});

    expect(deps.playwrightClient.getSimplifiedDOM).toHaveBeenCalledOnce();
    expect(deps.cache.set).toHaveBeenCalledWith('snap-001', snapshot);

    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('[Page Snapshot] snapshot_id: snap-001');
    expect(result.content[0].text).toContain('Viewport: 1280x720 | Elements: 2');
    expect(result.content[0].text).toContain('[1] <button> "Login" @ (10,20,80,30)');
    expect(result.content[0].text).toContain('[2] <input> @ (10,60,200,24)');

    expect(result.content[1].type).toBe('image');
    expect(result.content[1].data).toBe('base64jpegdata==');
    expect(result.content[1].mimeType).toBe('image/jpeg');
  });

  it('should return error when playwright-server fails', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('playwright-server not reachable at http://localhost:3001')
    );

    registerAnalyzeTool(server as any, deps);
    const result = await server.tools[0].handler({});

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Error: playwright-server not reachable');
  });
});
