import { describe, expect, it, vi } from 'vitest';
import type { VisionAnalyzer } from '../../vision/vision-analyzer.js';
import type { VisionSnapshotLoader } from '../../vision/snapshot-loader.js';
import { VisionToolProvider } from './vision-tool-provider.js';

const snapshot = {
  snapshot_id: 'snapshot-1',
  version: '2.0' as const,
  annotated_screenshot_base64: 'image',
  elements_map: {
    '1': {
      id: '1',
      tag: 'button',
      text: '提交',
      bbox: { x: 1, y: 2, width: 10, height: 20 },
      locator_bundle: {
        nebula_id: '1',
        css: 'button',
        xpath: '//button',
        role: 'button',
        testid: null,
        aria: null,
        text: '提交',
      },
    },
  },
  simplified_dom: { elements: [], viewport: { width: 800, height: 600 } },
};

describe('VisionToolProvider', () => {
  it('publishes only the two Vision v2 product tools', async () => {
    const provider = new VisionToolProvider({} as VisionAnalyzer, {} as VisionSnapshotLoader);
    await provider.initialize();
    expect(provider.getTools().map((tool) => tool.name)).toEqual([
      'vision.analyze_page',
      'vision.resolve_target',
    ]);
    expect(provider.getTools().every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it('loads an immutable binding before resolving a target', async () => {
    const loader = { load: vi.fn(async () => ({ snapshot, attachment: {} })) };
    const analyzer = {
      resolveTarget: vi.fn(async () => ({ nebula_id: '1', confidence: 0.9, reasoning: 'match' })),
    };
    const provider = new VisionToolProvider(
      analyzer as unknown as VisionAnalyzer,
      loader as unknown as VisionSnapshotLoader
    );
    await provider.initialize();
    const tool = provider.getTools().find((candidate) => candidate.name === 'vision.resolve_target')!;
    const result = JSON.parse(await tool.execute({ binding: { schema: 'binding' }, description: '提交按钮' }));
    expect(loader.load).toHaveBeenCalledWith({ schema: 'binding' }, undefined);
    expect(analyzer.resolveTarget).toHaveBeenCalledWith(snapshot, '提交按钮');
    expect(result).toMatchObject({
      ok: true,
      snapshot_id: 'snapshot-1',
      nebula_id: '1',
      element: { locator_bundle: { css: 'button' } },
    });
  });

  it('analyzes a page and contains rejected bindings without calling the model', async () => {
    const loader = { load: vi.fn(async () => ({ snapshot, attachment: {} })) };
    const analyzer = {
      analyzePage: vi.fn(async () => ({
        summary: '登录页',
        notable_elements: [],
        risks: [],
        reasoning: 'visible evidence',
      })),
    };
    const provider = new VisionToolProvider(
      analyzer as unknown as VisionAnalyzer,
      loader as unknown as VisionSnapshotLoader
    );
    await provider.initialize();
    const tool = provider.getTools().find((candidate) => candidate.name === 'vision.analyze_page')!;
    await expect(tool.execute({ binding: {}, objective: '识别页面' })).resolves.toContain('登录页');

    loader.load.mockRejectedValueOnce(new Error('hash mismatch'));
    const rejected = JSON.parse(await tool.execute({ binding: {} }));
    expect(rejected).toMatchObject({ ok: false, code: 'VISION_SNAPSHOT_REJECTED', retryable: false });
    expect(analyzer.analyzePage).toHaveBeenCalledTimes(1);
  });
});
