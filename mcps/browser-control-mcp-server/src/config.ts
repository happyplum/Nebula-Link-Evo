import { z } from 'zod';

const envSchema = z.object({
  PLAYWRIGHT_SERVER_URL: z.string().url().default('http://localhost:3001'),
});

export type Config = z.infer<typeof envSchema>;
export type BrowserControlConfig = Config;

export function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid configuration:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}
