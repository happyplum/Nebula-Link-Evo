import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PLAYWRIGHT_SERVER_URL: z.string().default('http://localhost:3001'),
  VISION_PROVIDER_BASE_URL: z.string().min(1, 'VISION_PROVIDER_BASE_URL is required'),
  VISION_PROVIDER_API_KEY: z.string().min(1, 'VISION_PROVIDER_API_KEY is required'),
  VISION_MODEL_ID: z.string().min(1, 'VISION_MODEL_ID is required'),
  VISION_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  VISION_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
  VISION_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  VISION_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
});

export type VisionConfig = z.infer<typeof envSchema>;

export function loadConfig(): VisionConfig {
  return envSchema.parse(process.env);
}
