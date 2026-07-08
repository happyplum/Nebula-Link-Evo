/** Vision model matching result. */
export interface VisionMatchResult {
  nebula_id: string | null;
  confidence: number;
  reasoning: string;
}

/** Configuration for the vision analyzer. */
export interface VisionConfig {
  providerBaseUrl: string;
  apiKey: string;
  modelId: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
}
