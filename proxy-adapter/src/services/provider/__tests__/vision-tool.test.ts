import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  createWorkerLogger: vi.fn(() => mockLogger),
}));

import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createVisionTool, type ScreenshotResult } from '../vision-tool.js';
import { createMockLanguageModel } from './helpers/mock-factory.js';

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>();
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

import { generateText } from 'ai';
const mockGenerateText = vi.mocked(generateText);

const mockScreenshot: ScreenshotResult = {
  screenshot: Buffer.from('fake-png-data'),
  viewport: { width: 1920, height: 1080 },
};

const defaultOptions = { timeoutMs: 5000, maxCallsPerStep: 3 };

/** Mock model with supportedUrls to satisfy LanguageModelV3 */
function mockModel(): LanguageModelV3 {
  return {
    ...createMockLanguageModel(),
    supportedUrls: {},
  } as unknown as LanguageModelV3;
}

describe('createVisionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs metadata with phase, provider, and model after generateText completes', async () => {
    mockGenerateText.mockResolvedValue({ text: 'A login form with email and password fields' } as never);

    const screenshotFn = vi.fn<() => Promise<ScreenshotResult>>().mockResolvedValue(mockScreenshot);
    const visionTool = createVisionTool(mockModel(), screenshotFn, defaultOptions);

    await visionTool.execute!({ prompt: 'describe the page' }, {} as never);

    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        phase: 'vision',
        provider: 'test-provider',
        model: 'test-model',
      },
      'Vision phase'
    );
  });

  it('returns description from generateText on happy path', async () => {
    mockGenerateText.mockResolvedValue({ text: 'A login form with email and password fields' } as never);

    const screenshotFn = vi.fn<() => Promise<ScreenshotResult>>().mockResolvedValue(mockScreenshot);
    const visionTool = createVisionTool(mockModel(), screenshotFn, defaultOptions);

    const result = await visionTool.execute!({ prompt: 'describe the page' }, {} as never);

    expect(screenshotFn).toHaveBeenCalledOnce();
    expect(mockGenerateText).toHaveBeenCalledOnce();
    expect(result).toEqual({ description: 'A login form with email and password fields' });
  });

  it('returns error object after maxCallsPerStep is reached', async () => {
    mockGenerateText.mockResolvedValue({ text: 'ok' } as never);

    const screenshotFn = vi.fn<() => Promise<ScreenshotResult>>().mockResolvedValue(mockScreenshot);
    const visionTool = createVisionTool(mockModel(), screenshotFn, { ...defaultOptions, maxCallsPerStep: 2 });

    await visionTool.execute!({ prompt: 'first' }, {} as never);
    await visionTool.execute!({ prompt: 'second' }, {} as never);
    const result = await visionTool.execute!({ prompt: 'third — should be blocked' }, {} as never);

    expect(result).toEqual({ error: 'Vision call limit reached for this step', description: '' });
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it('calls generateText without tools parameter (recursion prevention)', async () => {
    mockGenerateText.mockResolvedValue({ text: 'page layout' } as never);

    const screenshotFn = vi.fn<() => Promise<ScreenshotResult>>().mockResolvedValue(mockScreenshot);
    const visionTool = createVisionTool(mockModel(), screenshotFn, defaultOptions);

    await visionTool.execute!({ prompt: 'describe layout' }, {} as never);

    const callArg = mockGenerateText.mock.calls[0]![0];
    expect(callArg).not.toHaveProperty('tools');
  });
});
