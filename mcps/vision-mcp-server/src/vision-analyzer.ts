import { generateText, type LanguageModel } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { DOMSnapshotResponse } from '@nebula-link-evo/shared';
import type { VisionConfig } from './config.js';
import type { VisionMatchResult } from './types.js';
import { buildElementsContext, buildFindingPrompt } from './prompts/element-finding.js';

export class VisionAnalyzer {
  private model: LanguageModel;

  constructor(config: VisionConfig) {
    const provider = createOpenAICompatible({
      name: 'vision',
      baseURL: config.VISION_PROVIDER_BASE_URL,
      apiKey: config.VISION_PROVIDER_API_KEY,
    });
    this.model = provider(config.VISION_MODEL_ID);
  }

  /**
   * Find an element matching the description using vision AI.
   *
   * 1. Build elements context from snapshot
   * 2. Call vision model with annotated screenshot + prompt
   * 3. Parse JSON response
   * 4. Validate nebula_id exists in elements_map
   * 5. Return VisionMatchResult
   *
   * On parse failure or invalid nebula_id, retry up to VISION_MAX_RETRIES times.
   * After all retries, return { nebula_id: null, confidence: 0, reasoning: "..." }.
   */
  async findElement(
    snapshot: DOMSnapshotResponse,
    description: string,
    config: VisionConfig
  ): Promise<VisionMatchResult> {
    const elementsContext = buildElementsContext(snapshot.elements_map);
    const prompt = buildFindingPrompt(elementsContext, description);

    for (let attempt = 0; attempt <= config.VISION_MAX_RETRIES; attempt++) {
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
          maxOutputTokens: 512,
          temperature: config.VISION_TEMPERATURE,
          abortSignal: AbortSignal.timeout(config.VISION_TIMEOUT_MS),
        });

        const parsed = this.parseResponse(result.text);

        if (parsed.nebula_id !== null && !(parsed.nebula_id in snapshot.elements_map)) {
          if (attempt < config.VISION_MAX_RETRIES) continue;
          return {
            nebula_id: null,
            confidence: 0,
            reasoning: `Vision model returned invalid nebula_id "${parsed.nebula_id}"`,
          };
        }

        return parsed;
      } catch (error) {
        console.error(
          `Vision attempt ${attempt + 1} failed:`,
          error instanceof Error ? error.message : String(error)
        );
        if (attempt === config.VISION_MAX_RETRIES) {
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

  /**
   * Parse vision model response text into VisionMatchResult.
   * Handles: pure JSON, JSON wrapped in markdown code blocks, leading/trailing text.
   * @throws {Error} when the response cannot be parsed as valid JSON
   */
  private parseResponse(text: string): VisionMatchResult {
    if (!text || !text.trim()) {
      throw new Error('Empty response from vision model');
    }

    // Try direct parse first
    try {
      const parsed: unknown = JSON.parse(text);
      return normalizeResult(parsed);
    } catch {
      // not pure JSON
    }

    // Try extracting JSON from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const parsed: unknown = JSON.parse(codeBlockMatch[1].trim());
        return normalizeResult(parsed);
      } catch {
        // code block content not valid JSON
      }
    }

    // Try finding JSON object in text
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

/**
 * Normalize a parsed unknown value into VisionMatchResult.
 * Validates the structure and coerces types.
 */
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
