import { z } from 'zod';

const visionConfigSchema = z.object({
  providerBaseUrl: z.string().min(1, 'providerBaseUrl is required'),
  apiKey: z.string().min(1, 'apiKey is required'),
  modelId: z.string().min(1, 'modelId is required'),
  maxTokens: z.coerce.number().int().positive().default(2048),
  temperature: z.coerce.number().min(0).max(2).default(0.1),
  timeoutMs: z.coerce.number().int().positive().default(30000),
  maxRetries: z.coerce.number().int().min(0).default(2),
});

export type VisionConfig = z.infer<typeof visionConfigSchema>;

/**
 * External config override passed into VisionAgentProvider.
 * Settings fields are optional — zod defaults in loadVisionConfig fill them.
 */
export interface VisionConfigOverride {
  providerBaseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export function loadVisionConfig(config?: VisionConfigOverride): VisionConfig {
  const raw = {
    providerBaseUrl:
      config?.providerBaseUrl ??
      process.env.VISION_PROVIDER_BASE_URL ??
      '',
    apiKey:
      config?.apiKey ??
      process.env.VISION_PROVIDER_API_KEY ??
      '',
    modelId:
      config?.modelId ??
      process.env.VISION_MODEL_ID ??
      '',
    maxTokens:
      config?.maxTokens ??
      process.env.VISION_MAX_TOKENS,
    temperature:
      config?.temperature ??
      process.env.VISION_TEMPERATURE,
    timeoutMs:
      config?.timeoutMs ??
      process.env.VISION_TIMEOUT_MS,
    maxRetries:
      config?.maxRetries ??
      process.env.VISION_MAX_RETRIES,
  };

  const result = visionConfigSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.issues
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    throw new Error(`Vision config validation failed: ${errors}`);
  }

  return result.data;
}
