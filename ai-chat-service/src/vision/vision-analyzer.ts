import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { VisionConfig } from './types.js';
import type { VisionMatchResult, VisionPageAnalysis } from './types.js';
import { VisionAnalysisError } from './errors.js';
import {
  buildAnalyzePagePrompt,
  buildElementsContext,
  buildFindingPrompt,
} from './prompts/element-finding.js';

export class VisionAnalyzer {
  private model: LanguageModelV3;
  private config: VisionConfig;

  constructor(model: LanguageModelV3, config: VisionConfig) {
    this.model = model;
    this.config = config;
  }

  getConfig(): VisionConfig {
    return this.config;
  }

  async resolveTarget(
    snapshot: DOMSnapshotResponse,
    description: string
  ): Promise<VisionMatchResult> {
    const elementsContext = buildElementsContext(snapshot.elements_map);
    const prompt = buildFindingPrompt(elementsContext, description);
    const parsed = await this.generateJson(snapshot, prompt, normalizeTargetResult);
    if (parsed.nebula_id !== null && !(parsed.nebula_id in snapshot.elements_map)) {
      return {
        nebula_id: null,
        confidence: 0,
        ambiguous: true,
        reasoning: `Vision model returned invalid nebula_id "${parsed.nebula_id}"`,
      };
    }
    return parsed;
  }

  async analyzePage(
    snapshot: DOMSnapshotResponse,
    objective?: string
  ): Promise<VisionPageAnalysis> {
    const elementsContext = buildElementsContext(snapshot.elements_map);
    return this.generateJson(
      snapshot,
      buildAnalyzePagePrompt(elementsContext, objective),
      normalizePageAnalysis
    );
  }

  private async generateJson<T>(
    snapshot: DOMSnapshotResponse,
    prompt: string,
    normalize: (value: unknown) => T
  ): Promise<T> {
    const maxRetries = this.config.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const result = await generateText({
          model: this.model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', image: snapshot.annotated_screenshot_base64 },
                { type: 'text', text: prompt },
              ],
            },
          ],
          maxOutputTokens: this.config.maxTokens,
          temperature: this.config.temperature,
          abortSignal: AbortSignal.timeout(this.config.timeoutMs),
        });

        return normalize(this.parseResponse(result.text));
      } catch (error) {
        if (attempt === maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          const isTimeout =
            message.includes('timeout') ||
            message.includes('aborted') ||
            message.includes('AbortError') ||
            (error instanceof DOMException && error.name === 'TimeoutError');
          throw new VisionAnalysisError(
            isTimeout
              ? { code: 'VISION_TIMEOUT', message, retryable: true }
              : { code: 'VISION_ERROR', message, retryable: false }
          );
        }
      }
    }

    throw new VisionAnalysisError({
      code: 'VISION_ERROR',
      message: 'Vision model retry budget was exhausted',
      retryable: false,
    });
  }

  private parseResponse(text: string): unknown {
    if (!text || !text.trim()) {
      throw new Error('Empty response from vision model');
    }

    try {
      const parsed: unknown = JSON.parse(text);
      return parsed;
    } catch {
      // not pure JSON
    }

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed: unknown = JSON.parse(codeBlockMatch[1].trim());
        return parsed;
      } catch {
        // code block content not valid JSON
      }
    }

    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed: unknown = JSON.parse(braceMatch[0]);
        return parsed;
      } catch {
        // embedded JSON not valid
      }
    }

    throw new Error(`Failed to parse vision response: ${text.slice(0, 200)}`);
  }
}

function normalizeTargetResult(value: unknown): VisionMatchResult {
  if (typeof value !== 'object' || value === null) {
    return {
      nebula_id: null,
      confidence: 0,
      ambiguous: true,
      reasoning: 'Vision response is not a JSON object',
    };
  }

  const obj = value as Record<string, unknown>;

  return {
    nebula_id:
      obj.nebula_id === null || typeof obj.nebula_id === 'string'
        ? (obj.nebula_id as string | null)
        : null,
    confidence:
      typeof obj.confidence === 'number' &&
      Number.isFinite(obj.confidence) &&
      obj.confidence >= 0 &&
      obj.confidence <= 1
        ? obj.confidence
        : 0,
    ambiguous: obj.ambiguous === false ? false : true,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : 'No reasoning provided',
  };
}

function normalizePageAnalysis(value: unknown): VisionPageAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Vision page analysis is not an object');
  }
  const record = value as Record<string, unknown>;
  const notable = Array.isArray(record.notable_elements)
    ? record.notable_elements.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const element = item as Record<string, unknown>;
        return typeof element.nebula_id === 'string' && typeof element.description === 'string'
          ? [
              {
                nebula_id: element.nebula_id,
                description: element.description,
                confidence: typeof element.confidence === 'number' ? element.confidence : 0,
              },
            ]
          : [];
      })
    : [];
  return {
    summary: typeof record.summary === 'string' ? record.summary : '',
    notable_elements: notable,
    risks: Array.isArray(record.risks)
      ? record.risks.filter((item): item is string => typeof item === 'string')
      : [],
    reasoning: typeof record.reasoning === 'string' ? record.reasoning : '',
  };
}
