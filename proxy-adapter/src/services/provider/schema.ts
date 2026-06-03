import { z } from 'zod';

// Per-provider entry in config file (raw, before resolution)
const rawProviderEntrySchema = z.object({
  npmPackage: z.string().default('@ai-sdk/openai-compatible'),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  allowDynamicInstall: z.boolean().default(false),
});

export const ProviderSchemaV2 = z.object({
  providers: z.record(z.string(), rawProviderEntrySchema),
  defaults: z.object({
    decision: z.string(),
    vision: z.string(),
  }),
})

export type ProviderSchemaV2Input = z.input<typeof ProviderSchemaV2>;
export type ProviderSchemaV2Output = z.output<typeof ProviderSchemaV2>;
