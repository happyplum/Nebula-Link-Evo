import { tool, generateText } from 'ai';
import { z } from 'zod';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { createWorkerLogger } from '../logger.js';

const logger = createWorkerLogger('VisionTool');

export interface VisionToolOptions {
  timeoutMs: number;
  maxCallsPerStep: number;
}

export interface ScreenshotResult {
  screenshot: Buffer;
  viewport: { width: number; height: number };
}

export function createVisionTool(
  visionModel: LanguageModelV3,
  screenshotFn: () => Promise<ScreenshotResult>,
  options: VisionToolOptions,
) {
  let callCount = 0;

  return tool({
    description:
      'Analyze the current page screenshot to identify UI elements, layout, and visual context. Use this when you need to see what is on the page.',
    inputSchema: z.object({
      prompt: z
        .string()
        .describe(
          'What to look for in the screenshot, e.g., "find the login button" or "describe the current page layout"',
        ),
    }),
    execute: async ({ prompt }) => {
      if (callCount >= options.maxCallsPerStep) {
        return { error: 'Vision call limit reached for this step', description: '' };
      }
      callCount++;

      const screenshot = await screenshotFn();
      const result = await generateText({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: screenshot.screenshot },
              { type: 'text', text: prompt },
            ],
          },
        ],
        maxOutputTokens: 1000,
        abortSignal: AbortSignal.timeout(options.timeoutMs),
      });

      logger.info(
        {
          phase: 'vision',
          provider: visionModel.provider,
          model: visionModel.modelId,
        },
        'Vision phase'
      );

      return { description: result.text };
    },
  });
}
