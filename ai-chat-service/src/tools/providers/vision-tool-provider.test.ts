import { describe, expect, it, vi } from 'vitest';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';
import type { VisionAnalyzer } from '../../vision/vision-analyzer.js';
import { VisionAnalysisError } from '../../vision/errors.js';
import type { VisionSnapshotLoader } from '../../vision/snapshot-loader.js';
import { VisionToolProvider } from './vision-tool-provider.js';
import type { GatewayTool } from '../types.js';

function requireTool(provider: VisionToolProvider, name: string): GatewayTool {
  const tool = provider.getTools().find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing fixture tool ${name}`);
  return tool;
}

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
        css: 'button[data-testid="submit\\:button"]',
        xpath: '//button',
        role: '[role="button"][name="提交"]',
        testid: '[data-testid="submit\\:button"]',
        aria: '[aria-label="提交"]',
        text: 'text=提交',
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
    expect(
      provider.getTools().every((tool) => tool.inputSchema.additionalProperties === false)
    ).toBe(true);
    for (const tool of provider.getTools()) assertObjectJsonSchema(tool.inputSchema);
  });

  it('loads an immutable binding before resolving a target', async () => {
    const loader = { load: vi.fn(async () => ({ snapshot, attachment: {} })) };
    const analyzer = {
      resolveTarget: vi.fn(async () => ({
        nebula_id: '1',
        confidence: 0.9,
        ambiguous: false,
        reasoning: 'match',
      })),
    };
    const provider = new VisionToolProvider(
      analyzer as unknown as VisionAnalyzer,
      loader as unknown as VisionSnapshotLoader
    );
    await provider.initialize();
    const tool = requireTool(provider, 'vision.resolve_target');
    const result = JSON.parse(
      await tool.execute({ binding: { schema: 'binding' }, description: '提交按钮' })
    );
    expect(loader.load).toHaveBeenCalledWith({ schema: 'binding' }, undefined);
    expect(analyzer.resolveTarget).toHaveBeenCalledWith(snapshot, '提交按钮');
    expect(result).toMatchObject({
      ok: true,
      snapshot_id: 'snapshot-1',
      target: {
        semantic: '提交按钮',
        candidates: [
          { strategy: 'role', role: 'button', name: '提交', exact: true },
          { strategy: 'test_id', value: 'submit:button' },
          { strategy: 'label', value: '提交', exact: true },
          { strategy: 'text', value: '提交', exact: true },
          { strategy: 'css', value: 'button[data-testid="submit\\:button"]' },
          { strategy: 'xpath', value: '//button' },
        ],
      },
      evidence: { nebula_id: '1' },
    });
  });

  it.each([
    [
      { nebula_id: '1', confidence: 0.6, ambiguous: false, reasoning: 'weak' },
      'VISION_TARGET_LOW_CONFIDENCE',
    ],
    [
      { nebula_id: '1', confidence: 0.9, ambiguous: true, reasoning: 'two matches' },
      'VISION_TARGET_AMBIGUOUS',
    ],
  ])('fails closed for uncertain target evidence', async (match, code) => {
    const provider = new VisionToolProvider(
      { resolveTarget: vi.fn(async () => match) } as unknown as VisionAnalyzer,
      { load: vi.fn(async () => ({ snapshot, attachment: {} })) } as unknown as VisionSnapshotLoader
    );
    await provider.initialize();
    const tool = requireTool(provider, 'vision.resolve_target');
    const result = JSON.parse(await tool.execute({ binding: {}, description: '提交按钮' }));
    expect(result).toMatchObject({ ok: false, code, retryable: false });
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
    const tool = requireTool(provider, 'vision.analyze_page');
    await expect(tool.execute({ binding: {}, objective: '识别页面' })).resolves.toContain('登录页');

    loader.load.mockRejectedValueOnce(new Error('hash mismatch'));
    const rejected = JSON.parse(await tool.execute({ binding: {} }));
    expect(rejected).toMatchObject({
      ok: false,
      code: 'VISION_SNAPSHOT_REJECTED',
      retryable: false,
    });
    expect(analyzer.analyzePage).toHaveBeenCalledTimes(1);
  });

  it('fails closed for missing descriptions, missing locators and typed Vision failures', async () => {
    const analyzer = {
      analyzePage: vi.fn(async () => ({
        summary: '',
        notable_elements: [],
        risks: [],
        reasoning: '',
      })),
      resolveTarget: vi
        .fn()
        .mockResolvedValueOnce({
          nebula_id: 'missing',
          confidence: 0.9,
          ambiguous: false,
          reasoning: 'missing element',
        })
        .mockResolvedValueOnce({
          nebula_id: '1',
          confidence: 0.9,
          ambiguous: false,
          reasoning: 'no locator',
        }),
    };
    const snapshotWithoutLocators = {
      ...snapshot,
      elements_map: {
        '1': { ...snapshot.elements_map['1'], locator_bundle: { nebula_id: '1' } },
      },
    };
    const loader = {
      load: vi.fn(async () => ({ snapshot: snapshotWithoutLocators, attachment: {} })),
    };
    const provider = new VisionToolProvider(
      analyzer as unknown as VisionAnalyzer,
      loader as unknown as VisionSnapshotLoader
    );
    await provider.initialize();
    const analyze = requireTool(provider, 'vision.analyze_page');
    const resolve = requireTool(provider, 'vision.resolve_target');

    await analyze.execute({ binding: {} });
    expect(analyzer.analyzePage).toHaveBeenCalledWith(snapshotWithoutLocators, undefined);
    await expect(resolve.execute({ binding: {}, description: 'Missing' })).resolves.toContain(
      'VISION_TARGET_LOW_CONFIDENCE'
    );
    await expect(resolve.execute({ binding: {}, description: 'No locator' })).resolves.toContain(
      'VISION_TARGET_HAS_NO_LOCATOR'
    );
    await expect(resolve.execute({ binding: {}, description: ' ' })).resolves.toContain(
      'VISION_SNAPSHOT_REJECTED'
    );
    await expect(analyze.execute(null)).resolves.toContain('VISION_SNAPSHOT_REJECTED');

    loader.load.mockRejectedValueOnce(
      new VisionAnalysisError({ code: 'VISION_TIMEOUT', message: 'timed out', retryable: true })
    );
    await expect(analyze.execute({ binding: {} })).resolves.toContain('VISION_TIMEOUT');
    await provider.shutdown();
    expect(provider.getTools()).toEqual([]);
  });
});
