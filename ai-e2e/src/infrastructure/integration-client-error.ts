export class IntegrationClientError extends Error {
  constructor(
    readonly service: 'ai-chat-service' | 'proxy-adapter',
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'IntegrationClientError';
  }
}

