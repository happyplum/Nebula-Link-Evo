/** Vision model matching result. */
export interface VisionMatchResult {
  nebula_id: string | null;
  confidence: number;
  reasoning: string;
}

export interface VisionPageAnalysis {
  summary: string;
  notable_elements: Array<{
    nebula_id: string;
    description: string;
    confidence: number;
  }>;
  risks: string[];
  reasoning: string;
}

/** Configuration for the vision analyzer. */
export interface VisionConfig {
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
  maxRetries: number;
}
