import { vi } from 'vitest';
import type { ProviderConfig } from '../../types.js';

/**
 * Create a mock provider config for testing.
 */
export function createTestConfig(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    npmPackage: '@ai-sdk/openai-compatible',
    apiKey: 'test-api-key',
    ...overrides,
  };
}

/**
 * Create a mock LanguageModelV3 for testing streaming and generation.
 */
export function createMockLanguageModel(config?: {
  modelId?: string;
  provider?: string;
}) {
  const modelId = config?.modelId ?? 'test-model';
  const providerName = config?.provider ?? 'test-provider';

  return {
    modelId,
    provider: providerName,
    specificationVersion: 'v3' as const,
    defaultObjectGenerationMode: 'json' as const,

    doGenerate: vi.fn(async () => ({
      text: 'Mock generate response',
      finishReason: { type: 'stop' as const },
      usage: { promptTokens: 10, completionTokens: 4 },
    })),

    doStream: vi.fn(async function* () {
      yield { type: 'text-delta' as const, textDelta: 'Mock stream' };
      yield {
        type: 'finish' as const,
        finishReason: { type: 'stop' as const },
        usage: { promptTokens: 10, completionTokens: 4 },
      };
    }),
  };
}

/**
 * Create a mock provider instance (for registry tests).
 */
export function createMockProvider(config?: { provider?: string; model?: string }) {
  return {
    provider: config?.provider ?? 'test-provider',
    model: config?.model ?? 'test-model',
  };
}

/**
 * Create a mock screenshot response for vision tool testing.
 */
export function createMockScreenshot() {
  return {
    snapshot_id: 'test-snapshot-id',
    version: '2.0' as const,
    annotated_screenshot_base64: 'mock-base64-screenshot-data',
    elements_map: {},
    simplified_dom: {
      title: 'Test Page',
      url: 'https://test.example.com',
      elements: [],
    },
  };
}
