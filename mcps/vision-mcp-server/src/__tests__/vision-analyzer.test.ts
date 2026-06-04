import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DOMSnapshotResponse, ElementLocator } from '@nebula-link-evo/shared';
import type { VisionConfig } from '../config.js';
import { VisionAnalyzer } from '../vision-analyzer.js';
import { buildElementsContext, buildFindingPrompt } from '../prompts/element-finding.js';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { generateText } = vi.mocked(await import('ai'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSnapshot(overrides?: Partial<DOMSnapshotResponse>): DOMSnapshotResponse {
  return {
    snapshot_id: 'test-snapshot-id',
    version: '2.0',
    annotated_screenshot_base64: 'dGVzdA==',
    elements_map: {
      '1': {
        id: '1',
        tag: 'button',
        text: 'Login',
        bbox: { x: 100, y: 200, width: 80, height: 30 },
        locator_bundle: { role: 'button', text: 'Login' },
      },
      '2': {
        id: '2',
        tag: 'input',
        text: 'Email',
        bbox: { x: 100, y: 250, width: 200, height: 28 },
        locator_bundle: { role: 'textbox', text: 'Email' },
      },
    },
    simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } },
    ...overrides,
  };
}

function createMockConfig(overrides?: Partial<VisionConfig>): VisionConfig {
  return {
    PLAYWRIGHT_SERVER_URL: 'http://localhost:3001',
    VISION_PROVIDER_BASE_URL: 'http://localhost:4321/v1',
    VISION_PROVIDER_API_KEY: 'test-key',
    VISION_MODEL_ID: 'test-model',
    VISION_MAX_TOKENS: 512,
    VISION_TEMPERATURE: 0.1,
    VISION_TIMEOUT_MS: 30_000,
    VISION_MAX_RETRIES: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildElementsContext
// ---------------------------------------------------------------------------

describe('buildElementsContext', () => {
  it('formats elements sorted by numeric id', () => {
    const map: Record<string, ElementLocator> = {
      '3': {
        id: '3',
        tag: 'a',
        text: 'Link',
        bbox: { x: 10, y: 10, width: 50, height: 20 },
        locator_bundle: {},
      },
      '1': {
        id: '1',
        tag: 'button',
        text: 'Login',
        bbox: { x: 100, y: 200, width: 80, height: 30 },
        locator_bundle: {},
      },
      '2': {
        id: '2',
        tag: 'input',
        bbox: { x: 50, y: 60, width: 200, height: 28 },
        locator_bundle: {},
      },
    };

    const result = buildElementsContext(map);

    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('[1] <button> "Login" @ (100,200,80,30)');
    expect(lines[1]).toBe('[2] <input> @ (50,60,200,28)');
    expect(lines[2]).toBe('[3] <a> "Link" @ (10,10,50,20)');
  });

  it('returns empty string for empty map', () => {
    expect(buildElementsContext({})).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildFindingPrompt
// ---------------------------------------------------------------------------

describe('buildFindingPrompt', () => {
  it('contains element list, target description, and JSON format instructions', () => {
    const elementsContext = '[1] <button> "Login" @ (100,200,80,30)';
    const description = 'the login button';

    const prompt = buildFindingPrompt(elementsContext, description);

    expect(prompt).toContain('[1] <button> "Login" @ (100,200,80,30)');
    expect(prompt).toContain('the login button');
    expect(prompt).toContain('nebula_id');
    expect(prompt).toContain('confidence');
    expect(prompt).toContain('reasoning');
    expect(prompt).toContain('"nebula_id": null');
  });
});

// ---------------------------------------------------------------------------
// VisionAnalyzer
// ---------------------------------------------------------------------------

describe('VisionAnalyzer', () => {
  let analyzer: VisionAnalyzer;
  let config: VisionConfig;

  beforeEach(() => {
    vi.resetAllMocks();
    config = createMockConfig();
    analyzer = new VisionAnalyzer(config);
  });

  // 1. Successful element finding
  it('returns matching element on valid response', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({
      text: '{"nebula_id":"1","confidence":0.95,"reasoning":"Login button matches"}',
    });

    const result = await analyzer.findElement(snapshot, 'login button', config);

    expect(result).toEqual({
      nebula_id: '1',
      confidence: 0.95,
      reasoning: 'Login button matches',
    });
    expect(generateText).toHaveBeenCalledOnce();
  });

  // 2. No match
  it('returns null when vision model finds no match', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({
      text: '{"nebula_id":null,"confidence":0,"reasoning":"not found"}',
    });

    const result = await analyzer.findElement(snapshot, 'nonexistent element', config);

    expect(result).toEqual({
      nebula_id: null,
      confidence: 0,
      reasoning: 'not found',
    });
  });

  // 3. Invalid nebula_id triggers retries then returns null
  it('retries on invalid nebula_id and returns null after exhausting retries', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({
      text: '{"nebula_id":"999","confidence":0.8,"reasoning":"best guess"}',
    });

    const result = await analyzer.findElement(snapshot, 'something', config);

    // VISION_MAX_RETRIES=2 → 3 total attempts (0,1,2)
    expect(generateText).toHaveBeenCalledTimes(3);
    expect(result.nebula_id).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('999');
  });

  // 4. Response parsing — markdown wrapped JSON
  it('parses JSON from markdown code block', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({
      text: '```json\n{"nebula_id":"1","confidence":0.9,"reasoning":"test"}\n```',
    });

    const result = await analyzer.findElement(snapshot, 'login', config);

    expect(result).toEqual({
      nebula_id: '1',
      confidence: 0.9,
      reasoning: 'test',
    });
  });

  // 5. Response parsing — text with embedded JSON
  it('extracts JSON embedded in surrounding text', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({
      text: 'The answer is {"nebula_id":"1","confidence":0.9,"reasoning":"test"}',
    });

    const result = await analyzer.findElement(snapshot, 'login', config);

    expect(result).toEqual({
      nebula_id: '1',
      confidence: 0.9,
      reasoning: 'test',
    });
  });

  // 6. API error handling
  it('returns graceful null on API error', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockRejectedValue(new Error('Network timeout'));

    const result = await analyzer.findElement(snapshot, 'login', config);

    expect(result.nebula_id).toBeNull();
    expect(result.confidence).toBe(0);
    expect(result.reasoning).toContain('Network timeout');
  });

  // 7. Empty response
  it('handles empty response text', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValue({ text: '' });

    const result = await analyzer.findElement(snapshot, 'login', config);

    expect(result.nebula_id).toBeNull();
    expect(result.confidence).toBe(0);
  });

  // 8. Retries on parse failure then succeeds
  it('retries on parse failure and succeeds on next attempt', async () => {
    const snapshot = createMockSnapshot();
    generateText.mockResolvedValueOnce({ text: 'not json at all' }).mockResolvedValueOnce({
      text: '{"nebula_id":"2","confidence":0.88,"reasoning":"found it"}',
    });

    const result = await analyzer.findElement(snapshot, 'email input', config);

    expect(result).toEqual({
      nebula_id: '2',
      confidence: 0.88,
      reasoning: 'found it',
    });
    expect(generateText).toHaveBeenCalledTimes(2);
  });

  // 9. Zero retries configured
  it('respects zero max retries', async () => {
    const snapshot = createMockSnapshot();
    const zeroRetryConfig = createMockConfig({ VISION_MAX_RETRIES: 0 });
    generateText.mockResolvedValue({
      text: '{"nebula_id":"999","confidence":0.5,"reasoning":"invalid id"}',
    });

    const result = await analyzer.findElement(snapshot, 'something', zeroRetryConfig);

    expect(generateText).toHaveBeenCalledOnce();
    expect(result.nebula_id).toBeNull();
    expect(result.reasoning).toContain('999');
  });
});
