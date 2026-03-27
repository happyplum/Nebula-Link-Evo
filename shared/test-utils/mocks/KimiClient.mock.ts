import { vi } from 'vitest';
import type { DecisionClient, DecisionContext, Action } from '../../../proxy-adapter/src/clients/types.js';
import type { UIElement, ActionResult } from '../../../proxy-adapter/src/config/schema.js';

/**
 * Create a mock DecisionClient (compatible with KimiDecisionClient)
 *
 * @param config - Optional custom mock configuration
 * @returns Mock DecisionClient instance
 */
export function createKimiClientMock(config?: {
  provider?: string;
  model?: string;
  capabilities?: string[];
  shouldFail?: boolean;
  customDecide?: (context: DecisionContext) => Promise<Action>;
}): DecisionClient {
  const mockConfig = {
    provider: 'kimi',
    model: 'moonshot-v1-vision-preview',
    capabilities: ['decision'],
    shouldFail: false,
    ...config,
  };

  const mockClient = {
    provider: mockConfig.provider,
    model: mockConfig.model,
    capabilities: mockConfig.capabilities,

    decide: vi.fn(async (context: DecisionContext): Promise<Action> => {
      if (mockConfig.shouldFail) {
        throw new Error('Kimi API failed');
      }

      if (mockConfig.customDecide) {
        return mockConfig.customDecide(context);
      }

      // Default mock action
      return {
        type: 'finish',
        params: {},
        reasoning: 'Mock action',
      };
    }),

    getCapabilities: vi.fn(() => mockConfig.capabilities),
  } as unknown as DecisionClient;

  return mockClient;
}

/**
 * Create a mock UI element for testing
 */
export function createMockUIElement(overrides?: Partial<UIElement>): UIElement {
  return {
    id: 0,
    type: 'button',
    bbox: [100, 200, 300, 50],
    center: [250, 225],
    confidence: 0.95,
    ...overrides,
  };
}

/**
 * Create a mock action result for testing
 */
export function createMockActionResult(overrides?: Partial<ActionResult>): ActionResult {
  return {
    action: {
      type: 'click',
      params: { x: 100, y: 200 },
      reasoning: 'Test action',
    },
    success: true,
    message: 'Action completed',
    ...overrides,
  };
}