import { BrowserControlClient, BrowserControlError } from '@nebula-link-evo/browser-control-client';
import type {
  BrowserExecutionCapabilities,
  BrowserExecutionCredentials,
  BrowserLeaseView,
  BrowserOperationRecord,
  BrowserSessionEventRecord,
  BrowserSessionOptions,
  BrowserSessionView,
  CreateBrowserLeaseRequest,
  IssuedBrowserLease,
} from '@nebula-link-evo/shared/types/browser-execution';
import { IntegrationClientError } from './integration-client-error.js';

export interface SemanticBrowserClientPort {
  getCapabilities(): Promise<BrowserExecutionCapabilities>;
  createSession(
    idempotencyKey: string,
    options?: BrowserSessionOptions
  ): Promise<BrowserSessionView>;
  getSession(sessionId: string): Promise<BrowserSessionView>;
  listSessionEvents(
    sessionId: string,
    afterSeq?: number,
    limit?: number
  ): Promise<BrowserSessionEventRecord[]>;
  createLease(
    sessionId: string,
    idempotencyKey: string,
    input: CreateBrowserLeaseRequest
  ): Promise<IssuedBrowserLease>;
  revokeLease(
    sessionId: string,
    leaseId: string,
    leaseToken: string,
    idempotencyKey: string
  ): Promise<BrowserLeaseView>;
  closeSession(
    sessionId: string,
    idempotencyKey: string,
    credentials?: Pick<BrowserExecutionCredentials, 'leaseId' | 'leaseToken'>
  ): Promise<BrowserSessionView>;
  getOperation(operationId: string): Promise<BrowserOperationRecord>;
  downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer>;
}

export interface SemanticBrowserClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

export class SemanticBrowserClient implements SemanticBrowserClientPort {
  private readonly client: BrowserControlClient;

  constructor(config: SemanticBrowserClientConfig = {}) {
    const configured = config.baseUrl ?? process.env.PROXY_ADAPTER_URL ?? DEFAULT_BASE_URL;
    if (!configured.trim()) {
      throw new IntegrationClientError(
        'proxy-adapter',
        'dependency_unavailable',
        'proxy-adapter 未配置',
        true
      );
    }
    try {
      this.client = new BrowserControlClient({
        baseUrl: configured,
        requestTimeoutMs: config.timeoutMs ?? 30_000,
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async getCapabilities(): Promise<BrowserExecutionCapabilities> {
    return this.request(() => this.client.getCapabilities());
  }

  async createSession(
    idempotencyKey: string,
    options: BrowserSessionOptions = {}
  ): Promise<BrowserSessionView> {
    return this.request(() => this.client.createSession(options, idempotencyKey));
  }

  async getSession(sessionId: string): Promise<BrowserSessionView> {
    return this.request(() => this.client.getSession(sessionId));
  }

  async listSessionEvents(
    sessionId: string,
    afterSeq = 0,
    limit = 500
  ): Promise<BrowserSessionEventRecord[]> {
    return this.request(() => this.client.listSessionEvents(sessionId, afterSeq, limit));
  }

  async createLease(
    sessionId: string,
    idempotencyKey: string,
    input: CreateBrowserLeaseRequest
  ): Promise<IssuedBrowserLease> {
    return this.request(() => this.client.createLease(sessionId, input, idempotencyKey));
  }

  async revokeLease(
    sessionId: string,
    leaseId: string,
    leaseToken: string,
    idempotencyKey: string
  ): Promise<BrowserLeaseView> {
    return this.request(() =>
      this.client.revokeLease({ sessionId, leaseId, leaseToken }, idempotencyKey)
    );
  }

  async closeSession(
    sessionId: string,
    idempotencyKey: string,
    credentials?: Pick<BrowserExecutionCredentials, 'leaseId' | 'leaseToken'>
  ): Promise<BrowserSessionView> {
    return this.request(() => this.client.closeSession(sessionId, idempotencyKey, credentials));
  }

  async getOperation(operationId: string): Promise<BrowserOperationRecord> {
    return this.request(() => this.client.getOperation(operationId));
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    return this.request(async () =>
      Buffer.from(await this.client.downloadArtifact(sessionId, artifactId))
    );
  }

  private async request<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw mapError(error);
    }
  }
}

function mapError(error: unknown): IntegrationClientError {
  if (error instanceof IntegrationClientError) return error;
  if (error instanceof BrowserControlError) {
    return new IntegrationClientError(
      'proxy-adapter',
      error.code,
      error.message,
      error.retryable,
      error.statusCode,
      error.details,
      error.correlationId,
      error.cause === undefined ? undefined : { cause: error.cause }
    );
  }
  return new IntegrationClientError(
    'proxy-adapter',
    'dependency_unavailable',
    error instanceof Error ? error.message : 'proxy-adapter 请求失败',
    true,
    undefined,
    undefined,
    undefined,
    { cause: error }
  );
}
