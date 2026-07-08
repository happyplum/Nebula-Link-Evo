import { generateText } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { VisionConfig } from './types.js';
import type { VisionMatchResult } from './types.js';
import { buildElementsContext, buildFindingPrompt } from './prompts/element-finding.js';

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

  async findElement(
    snapshot: DOMSnapshotResponse,
    description: string,
  ): Promise<VisionMatchResult> {
    const elementsContext = buildElementsContext(snapshot.elements_map);
    const prompt = buildFindingPrompt(elementsContext, description);
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

        const parsed = this.parseResponse(result.text);

        if (parsed.nebula_id !== null && !(parsed.nebula_id in snapshot.elements_map)) {
          if (attempt < maxRetries) continue;
          return {
            nebula_id: null,
            confidence: 0,
            reasoning: `Vision model returned invalid nebula_id "${parsed.nebula_id}"`,
          };
        }

        return parsed;
      } catch (error) {
        if (attempt === maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          return {
            nebula_id: null,
            confidence: 0,
            reasoning: `Vision analysis failed: ${message}`,
          };
        }
      }
    }

    return { nebula_id: null, confidence: 0, reasoning: 'Max retries exceeded' };
  }

  private parseResponse(text: string): VisionMatchResult {
    if (!text || !text.trim()) {
      throw new Error('Empty response from vision model');
    }

    try {
      const parsed: unknown = JSON.parse(text);
      return normalizeResult(parsed);
    } catch {
      // not pure JSON
    }

    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed: unknown = JSON.parse(codeBlockMatch[1].trim());
        return normalizeResult(parsed);
      } catch {
        // code block content not valid JSON
      }
    }

    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed: unknown = JSON.parse(braceMatch[0]);
        return normalizeResult(parsed);
      } catch {
        // embedded JSON not valid
      }
    }

    throw new Error(`Failed to parse vision response: ${text.slice(0, 200)}`);
  }
}

function normalizeResult(value: unknown): VisionMatchResult {
  if (typeof value !== 'object' || value === null) {
    return {
      nebula_id: null,
      confidence: 0,
      reasoning: 'Vision response is not a JSON object',
    };
  }

  const obj = value as Record<string, unknown>;

  return {
    nebula_id:
      obj.nebula_id === null || typeof obj.nebula_id === 'string'
        ? (obj.nebula_id as string | null)
        : null,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : 'No reasoning provided',
  };
}
