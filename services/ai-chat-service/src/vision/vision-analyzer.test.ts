import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateText } from 'ai';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import { VisionAnalysisError } from './errors.js';
import { VisionAnalyzer } from './vision-analyzer.js';

vi.mock('ai', () => ({ generateText: vi.fn() }));

const generate = vi.mocked(generateText);
const snapshot: DOMSnapshotResponse = {
  snapshot_id: 'snapshot-1',
  version: '2.0',
  annotated_screenshot_base64: 'image-bytes',
  elements_map: {
    '1': {
      id: '1',
      tag: 'button',
      text: 'Submit',
      bbox: { x: 1, y: 2, width: 30, height: 20 },
      locator_bundle: { nebula_id: '1', css: '#submit' },
    },
  },
  simplified_dom: { elements: [], viewport: { width: 800, height: 600 } },
};

describe('VisionAnalyzer', () => {
  beforeEach(() => generate.mockReset());

  it('normalizes bounded page analysis and sends immutable image evidence', async () => {
    generate.mockResolvedValueOnce(
      response({
        summary: 'Ready page',
        notable_elements: [
          { nebula_id: '1', description: 'Submit button', confidence: 0.95 },
          { nebula_id: 2, description: 'invalid' },
          null,
        ],
        risks: ['none', 3],
        reasoning: 'DOM and screenshot agree',
      })
    );
    const analyzer = createAnalyzer();

    await expect(analyzer.analyzePage(snapshot, 'Check readiness')).resolves.toEqual({
      summary: 'Ready page',
      notable_elements: [{ nebula_id: '1', description: 'Submit button', confidence: 0.95 }],
      risks: ['none'],
      reasoning: 'DOM and screenshot agree',
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 500,
        temperature: 0,
        messages: [
          expect.objectContaining({
            content: expect.arrayContaining([
              { type: 'image', image: 'image-bytes' },
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('Check readiness'),
              }),
            ]),
          }),
        ],
      })
    );
  });

  it('parses fenced responses and rejects model ids outside the immutable snapshot', async () => {
    generate
      .mockResolvedValueOnce(
        textResponse(
          '```json\n{"nebula_id":"1","confidence":0.9,"ambiguous":false,"reasoning":"match"}\n```'
        )
      )
      .mockResolvedValueOnce(
        textResponse(
          'prefix {"nebula_id":"missing","confidence":0.8,"ambiguous":false,"reasoning":"hallucinated"} suffix'
        )
      )
      .mockResolvedValueOnce(textResponse('null'));
    const analyzer = createAnalyzer();

    await expect(analyzer.resolveTarget(snapshot, 'Submit')).resolves.toMatchObject({
      nebula_id: '1',
      confidence: 0.9,
      ambiguous: false,
    });
    await expect(analyzer.resolveTarget(snapshot, 'Missing')).resolves.toEqual({
      nebula_id: null,
      confidence: 0,
      ambiguous: true,
      reasoning: 'Vision model returned invalid nebula_id "missing"',
    });
    await expect(analyzer.resolveTarget(snapshot, 'Invalid response')).resolves.toMatchObject({
      nebula_id: null,
      confidence: 0,
      ambiguous: true,
    });
  });

  it('retries transient parsing failures and classifies terminal timeout and model errors', async () => {
    generate
      .mockResolvedValueOnce(textResponse('not-json'))
      .mockResolvedValueOnce(
        response({ summary: 'recovered', notable_elements: [], risks: [], reasoning: '' })
      );
    await expect(createAnalyzer(1).analyzePage(snapshot)).resolves.toMatchObject({
      summary: 'recovered',
    });

    generate.mockReset().mockRejectedValueOnce(new Error('request timeout'));
    await expect(createAnalyzer().analyzePage(snapshot)).rejects.toMatchObject({
      name: 'VisionAnalysisError',
      code: 'VISION_TIMEOUT',
      retryable: true,
    } satisfies Partial<VisionAnalysisError>);

    generate.mockReset().mockRejectedValueOnce('provider failed');
    await expect(createAnalyzer().resolveTarget(snapshot, 'Submit')).rejects.toMatchObject({
      code: 'VISION_ERROR',
      retryable: false,
    } satisfies Partial<VisionAnalysisError>);
  });
});

function createAnalyzer(maxRetries = 0): VisionAnalyzer {
  return new VisionAnalyzer({} as never, {
    maxTokens: 500,
    temperature: 0,
    timeoutMs: 1_000,
    maxRetries,
  });
}

function response(value: unknown): Awaited<ReturnType<typeof generateText>> {
  return textResponse(JSON.stringify(value));
}

function textResponse(text: string): Awaited<ReturnType<typeof generateText>> {
  return { text } as Awaited<ReturnType<typeof generateText>>;
}
