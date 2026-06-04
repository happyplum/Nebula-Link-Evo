import { describe, it, expect, vi } from 'vitest';
import type { ToolDeps } from '../../types.js';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { registerScreenshotTool } from '../../tools/screenshot.js';

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
    annotated_screenshot_base64: 'annotatedbase64==',
    elements_map: {},
    simplified_dom: {
      viewport: { width: 1280, height: 720 },
      elements: [],
    },
    ...overrides,
  };
}

describe('screenshot tool', () => {
  it('should register with name "screenshot"', () => {
    const server = createMockServer();
    const deps = createMockDeps();
    registerScreenshotTool(server as any, deps);
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('screenshot');
  });

  it('should return annotated JPEG when type is "annotated"', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    const snapshot = makeSnapshot();
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockResolvedValue(
      snapshot
    );

    registerScreenshotTool(server as any, deps);
    const result = await server.tools[0].handler({ type: 'annotated', fullPage: false });

    expect(deps.playwrightClient.getSimplifiedDOM).toHaveBeenCalledOnce();
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: 'annotatedbase64==',
      mimeType: 'image/jpeg',
    });
    expect(result.content[1].type).toBe('text');
    expect(result.content[1].text).toBe('Viewport: 1280x720 | Type: annotated');
  });

  it('should return raw PNG when type is "raw"', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    (deps.playwrightClient.getScreenshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      screenshot: 'rawbase64png==',
      viewport: { width: 1920, height: 1080 },
    });

    registerScreenshotTool(server as any, deps);
    const result = await server.tools[0].handler({ type: 'raw', fullPage: false });

    expect(deps.playwrightClient.getScreenshot).toHaveBeenCalledWith(false);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toEqual({
      type: 'image',
      data: 'rawbase64png==',
      mimeType: 'image/png',
    });
    expect(result.content[1].text).toBe('Viewport: 1920x1080 | Type: raw');
  });

  it('should pass fullPage flag for raw screenshots', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    (deps.playwrightClient.getScreenshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      screenshot: 'fullpagepng==',
      viewport: { width: 1280, height: 5000 },
    });

    registerScreenshotTool(server as any, deps);
    const result = await server.tools[0].handler({ type: 'raw', fullPage: true });

    expect(deps.playwrightClient.getScreenshot).toHaveBeenCalledWith(true);
    expect(result.content[1].text).toBe('Viewport: 1280x5000 | Type: raw');
  });

  it('should return error when getScreenshot returns success:false', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    (deps.playwrightClient.getScreenshot as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Screenshot request failed: browser not ready')
    );

    registerScreenshotTool(server as any, deps);
    const result = await server.tools[0].handler({ type: 'raw', fullPage: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Screenshot request failed');
  });

  it('should return error when resolveSnapshot fails for annotated mode', async () => {
    const server = createMockServer();
    const deps = createMockDeps();
    (deps.playwrightClient.getSimplifiedDOM as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('playwright-server not reachable')
    );

    registerScreenshotTool(server as any, deps);
    const result = await server.tools[0].handler({ type: 'annotated', fullPage: false });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('playwright-server not reachable');
  });
});
