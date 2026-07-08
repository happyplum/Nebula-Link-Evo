import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { MCPSDKClient } from '../../clients/mcp/sdk-client.js';
import type { VisionAnalyzer } from '../../vision/vision-analyzer.js';
import { VisionAnalysisError } from '../../vision/errors.js';
import type { VisionConfig } from '../../vision/types.js';
import { VisionToolProvider } from './vision-tool-provider.js';

const fakeVisionConfig: VisionConfig = {
  maxTokens: 1024,
  temperature: 0,
  timeoutMs: 30000,
  maxRetries: 1,
};

function buildGzipBase64(content = 'fake-image-bytes'): string {
  return gzipSync(Buffer.from(content)).toString('base64');
}

function buildSnapshotResponse(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_id: 'snap-001',
    version: '2.0' as const,
    annotated_screenshot_base64: buildGzipBase64(),
    elements_map: {
      'nebula-1': {
        id: 'nebula-1',
        tag: 'button',
        text: 'Submit',
        bbox: { x: 10, y: 20, width: 100, height: 40 },
        locator_bundle: { nebula_id: 'nebula-1', css: 'button.submit', xpath: '//button', role: null, testid: null, aria: null, text: null },
      },
    },
    simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } },
    ...overrides,
  };
}

class FakeMCPClient extends EventEmitter {
  callTool = vi.fn();
}

class FakeVisionAnalyzer {
  findElement = vi.fn();
}

describe('VisionToolProvider', () => {
  it('initializes with status ready', async () => {
    const provider = new VisionToolProvider(
      new FakeVisionAnalyzer() as unknown as VisionAnalyzer,
      new FakeMCPClient() as unknown as MCPSDKClient,
      fakeVisionConfig,
    );

    expect(provider.id).toBe('vision');
    expect(provider.status).toBe('initializing');

    await provider.initialize();
    expect(provider.status).toBe('ready');
  });

  it('getTools returns vision.find_element tool', async () => {
    const provider = new VisionToolProvider(
      new FakeVisionAnalyzer() as unknown as VisionAnalyzer,
      new FakeMCPClient() as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tools = provider.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('vision.find_element');
    expect(tools[0].exposeTo).toEqual(['chat']);
    expect(tools[0].isAvailable).toBe(true);
    expect(tools[0].inputSchema).toMatchObject({
      type: 'object',
      required: ['description'],
    });
  });

  it('happy path: calls MCP dom_snapshot, decompresses, calls visionAnalyzer, returns match JSON', async () => {
    const snapshot = buildSnapshotResponse();
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      raw: {},
      text: JSON.stringify(snapshot),
      parsed: snapshot,
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();
    fakeAnalyzer.findElement.mockResolvedValueOnce({
      nebula_id: 'nebula-1',
      confidence: 0.95,
      reasoning: 'Found the submit button',
    });

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'the submit button' });
    const parsed = JSON.parse(result);

    expect(fakeMcp.callTool).toHaveBeenCalledWith('gateway', 'browser-control.dom_snapshot', {});
    expect(fakeAnalyzer.findElement).toHaveBeenCalledOnce();
    expect(parsed.ok).toBe(true);
    expect(parsed.nebula_id).toBe('nebula-1');
    expect(parsed.snapshot_id).toBe('snap-001');
    expect(parsed.confidence).toBe(0.95);
    expect(parsed.reasoning).toBe('Found the submit button');
    expect(parsed.element).toEqual({ tag: 'button', text: 'Submit', bbox: { x: 10, y: 20, width: 100, height: 40 } });
  });

  it('failure path: MCP call throws → returns ok:false with code MCP_UNAVAILABLE', async () => {
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockRejectedValueOnce(new Error('gateway not reachable'));

    const fakeAnalyzer = new FakeVisionAnalyzer();

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'anything' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('MCP_UNAVAILABLE');
    expect(parsed.retryable).toBe(true);
  });

  it('handles result without parsed field by JSON.parsing text', async () => {
    const snapshot = buildSnapshotResponse();
    const fakeMcp = new FakeMCPClient();
    // Return only raw SDK result (no parsed field)
    fakeMcp.callTool.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(snapshot) }],
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();
    fakeAnalyzer.findElement.mockResolvedValueOnce({
      nebula_id: null,
      confidence: 0,
      reasoning: 'not found',
    });

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    // This should use the text-based fallback path
    // Since the result doesn't have 'text' at top level, it will try JSON.stringify
    // Let's test with a result that has text field but no parsed
    fakeMcp.callTool.mockReset();
    fakeMcp.callTool.mockResolvedValueOnce({
      text: JSON.stringify(snapshot),
    });

    const result2 = await tool.execute({ description: 'something' });
    const parsed2 = JSON.parse(result2);
    expect(parsed2.ok).toBe(true);
  });

  it('returns SNAPSHOT_DECODE_FAILED when gzip decompression fails', async () => {
    const snapshot = buildSnapshotResponse({ annotated_screenshot_base64: 'not-valid-gzip-base64!!!' });
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      parsed: snapshot,
      text: JSON.stringify(snapshot),
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'anything' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('SNAPSHOT_DECODE_FAILED');
  });

  it('returns INVALID_INPUT when description is missing or empty', async () => {
    const fakeMcp = new FakeMCPClient();
    const fakeAnalyzer = new FakeVisionAnalyzer();

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];

    // Missing description
    const result1 = await tool.execute({});
    const parsed1 = JSON.parse(result1);
    expect(parsed1.ok).toBe(false);
    expect(parsed1.code).toBe('INVALID_INPUT');
    expect(parsed1.retryable).toBe(false);

    // Empty string description
    const result2 = await tool.execute({ description: '' });
    const parsed2 = JSON.parse(result2);
    expect(parsed2.ok).toBe(false);
    expect(parsed2.code).toBe('INVALID_INPUT');

    // Null description
    const result3 = await tool.execute({ description: null });
    const parsed3 = JSON.parse(result3);
    expect(parsed3.ok).toBe(false);
    expect(parsed3.code).toBe('INVALID_INPUT');

    // MCP should never be called for invalid input
    expect(fakeMcp.callTool).not.toHaveBeenCalled();
  });

  it('returns SNAPSHOT_EMPTY when elements_map is empty', async () => {
    const snapshot = buildSnapshotResponse({ elements_map: {} });
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      parsed: snapshot,
      text: JSON.stringify(snapshot),
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'anything' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('SNAPSHOT_EMPTY');
    expect(parsed.retryable).toBe(true);
    expect(fakeAnalyzer.findElement).not.toHaveBeenCalled();
  });

  it('returns VISION_TIMEOUT when VisionAnalyzer throws VisionAnalysisError with code VISION_TIMEOUT', async () => {
    const snapshot = buildSnapshotResponse();
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      parsed: snapshot,
      text: JSON.stringify(snapshot),
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();
    fakeAnalyzer.findElement.mockRejectedValueOnce(
      new VisionAnalysisError({
        code: 'VISION_TIMEOUT',
        message: 'Vision model request timed out after 30000ms',
        retryable: true,
      }),
    );

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'the submit button' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('VISION_TIMEOUT');
    expect(parsed.message).toBe('Vision model request timed out after 30000ms');
    expect(parsed.retryable).toBe(true);
  });

  it('returns VISION_ERROR when VisionAnalyzer throws VisionAnalysisError with code VISION_ERROR', async () => {
    const snapshot = buildSnapshotResponse();
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      parsed: snapshot,
      text: JSON.stringify(snapshot),
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();
    fakeAnalyzer.findElement.mockRejectedValueOnce(
      new VisionAnalysisError({
        code: 'VISION_ERROR',
        message: 'Failed to parse vision response: invalid json',
        retryable: false,
      }),
    );

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'the submit button' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('VISION_ERROR');
    expect(parsed.message).toBe('Failed to parse vision response: invalid json');
    expect(parsed.retryable).toBe(false);
  });

  it('falls back to VISION_ERROR for non-typed errors from VisionAnalyzer', async () => {
    const snapshot = buildSnapshotResponse();
    const fakeMcp = new FakeMCPClient();
    fakeMcp.callTool.mockResolvedValueOnce({
      parsed: snapshot,
      text: JSON.stringify(snapshot),
    });

    const fakeAnalyzer = new FakeVisionAnalyzer();
    fakeAnalyzer.findElement.mockRejectedValueOnce(new Error('unexpected crash'));

    const provider = new VisionToolProvider(
      fakeAnalyzer as unknown as VisionAnalyzer,
      fakeMcp as unknown as MCPSDKClient,
      fakeVisionConfig,
    );
    await provider.initialize();

    const tool = provider.getTools()[0];
    const result = await tool.execute({ description: 'the submit button' });
    const parsed = JSON.parse(result);

    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('VISION_ERROR');
    expect(parsed.message).toBe('unexpected crash');
    expect(parsed.retryable).toBe(false);
  });
});
