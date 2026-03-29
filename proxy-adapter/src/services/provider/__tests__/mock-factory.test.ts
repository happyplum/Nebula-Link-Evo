import { describe, it, expect } from 'vitest';
import {
  createMockProvider,
  createTestConfig,
  createMockLanguageModel,
  createMockScreenshot,
} from './helpers';

describe('Mock Factory Helpers', () => {
  it('should create a mock provider', () => {
    const mock = createMockProvider();
    expect(mock.provider).toBe('test-provider');
    expect(mock.model).toBe('test-model');
  });

  it('should create a test config', () => {
    const config = createTestConfig();
    expect(config.npmPackage).toBe('@ai-sdk/openai-compatible');
    expect(config.apiKey).toBe('test-api-key');
  });

  it('should create a mock language model', async () => {
    const model = createMockLanguageModel();
    expect(model.modelId).toBe('test-model');
    expect(model.provider).toBe('test-provider');
    
    // Verify the mock has the expected structure
    expect(model).toHaveProperty('specificationVersion');
    expect(model).toHaveProperty('defaultObjectGenerationMode');
    expect(model).toHaveProperty('doGenerate');
    expect(model).toHaveProperty('doStream');
  });

  it('should create a mock screenshot', () => {
    const screenshot = createMockScreenshot();
    expect(screenshot.snapshot_id).toBe('test-snapshot-id');
    expect(screenshot.version).toBe('2.0');
    expect(screenshot.elements_map).toEqual({});
  });
});
