export type VisionAnalysisErrorCode = 'VISION_TIMEOUT' | 'VISION_ERROR';

export interface VisionAnalysisErrorDetails {
  code: VisionAnalysisErrorCode;
  message: string;
  retryable: boolean;
}

export class VisionAnalysisError extends Error implements VisionAnalysisErrorDetails {
  readonly code: VisionAnalysisErrorCode;
  readonly retryable: boolean;

  constructor(details: VisionAnalysisErrorDetails) {
    super(details.message);
    this.name = 'VisionAnalysisError';
    this.code = details.code;
    this.retryable = details.retryable;
  }
}
