import { describe, it, expect, vi } from 'vitest';
import type { ToolDeps } from '../../types.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { registerGetElementInfoTool } from '../../tools/get-element-info.js';

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
    annotated_screenshot_base64: 'base64==',
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

describe('get_element_info tool', () => {
  it('should register with name "get_element_info"', () => {
    const server = createMockServer();
    const deps = createMockDeps();
    registerGetElementInfoTool(server as any, deps);
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('get_element_info');
  });

  it('should return element info when found', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();
    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(snapshot);

    registerGetElementInfoTool(server as any, deps);
    const result = await server.tools[0].handler({
      nebula_id: '42',
      snapshot_id: 'snap-001',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toEqual({
      nebula_id: '42',
      tag: 'button',
      text: 'Login',
      bbox: { x: 120, y: 456, width: 80, height: 32 },
      locators: { role: 'button', text: 'Login', css: '#login-btn' },
      snapshot_id: 'snap-001',
    });
    expect(result.isError).toBeUndefined();
  });

  it('should return error when element not found', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();
    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(snapshot);

    registerGetElementInfoTool(server as any, deps);
    const result = await server.tools[0].handler({
      nebula_id: '99',
      snapshot_id: 'snap-001',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("Element '99' not found in snapshot");
    expect(result.isError).toBe(true);
  });

  it('should fetch fresh snapshot when cache miss', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockResolvedValue(
      snapshot
    );

    registerGetElementInfoTool(server as any, deps);
    const result = await server.tools[0].handler({
      nebula_id: '42',
      snapshot_id: 'snap-001',
    });

    expect(deps.playwrightClient.getSimplifiedDOM).toHaveBeenCalledOnce();
    expect(deps.cache.set).toHaveBeenCalledWith('snap-001', snapshot);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.nebula_id).toBe('42');
  });

  it('should return error when resolveSnapshot fails', async () => {
    const server = createMockServer();
    const deps = createMockDeps();

    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('playwright-server not reachable')
    );

    registerGetElementInfoTool(server as any, deps);
    const result = await server.tools[0].handler({
      nebula_id: '42',
      snapshot_id: 'snap-001',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('playwright-server not reachable');
  });

  it('should return error when cache miss and API also fails', async () => {
    const server = createMockServer();
    const deps = createMockDeps();

    // No snapshot_id provided — resolveSnapshot will check cache.latest()
    (deps.cache.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.cache.latest as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection refused')
    );

    registerGetElementInfoTool(server as any, deps);
    const result = await server.tools[0].handler({
      nebula_id: '42',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Connection refused');
  });
});
