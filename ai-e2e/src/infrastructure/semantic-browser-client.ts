import axios, { isAxiosError, type AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { IntegrationClientError } from './integration-client-error.js';

export interface BrowserLeaseView {
  id: string;
  sessionId: string;
  mode: 'observe' | 'control';
  sequence: number;
  status: 'active' | 'revoked' | 'expired';
  policy: { tabIds: string[]; operations: string[] };
  expiresAt: string;
  createdAt: string;
}

export interface BrowserSessionView {
  id: string;
  status: 'opening' | 'active' | 'closed' | 'interrupted' | 'failed';
  tabs: Array<{ id: string; url: string; title: string; isActive: boolean }>;
  activeLeases: BrowserLeaseView[];
  liveView: { available: boolean; controlAllowed: false };
  viewport: { width: number; height: number };
  createdAt: string;
}

export interface IssuedBrowserLease {
  lease: BrowserLeaseView;
  token?: string;
  tokenIssued: boolean;
}

export interface BrowserOperationRecord {
  operationId: string;
  sessionId: string;
  leaseId: string;
  leaseSequence: number;
  tabId?: string;
  kind: 'observe' | 'act';
  operation: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'outcome_unknown';
  actual?: unknown;
  artifacts: Array<{ id: string; kind: string; sha256: string; mimeType: string }>;
  error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
}

export interface BrowserSessionEventRecord {
  id: string;
  sessionId: string;
  seq: number;
  type: string;
  entityType: 'session' | 'lease' | 'operation' | 'capture' | 'artifact';
  entityId: string;
  stateVersion?: number;
  payload: Record<string, unknown>;
  occurredAt: string;
  createdAt: string;
}

export interface SemanticBrowserClientPort {
  getCapabilities(): Promise<Record<string, unknown>>;
  createSession(
    idempotencyKey: string,
    options?: { headless?: false; viewport?: { width: number; height: number } }
  ): Promise<BrowserSessionView>;
  getSession(sessionId: string): Promise<BrowserSessionView>;
  listSessionEvents?(
    sessionId: string,
    afterSeq?: number,
    limit?: number
  ): Promise<BrowserSessionEventRecord[]>;
  createLease(
    sessionId: string,
    idempotencyKey: string,
    input: { mode: 'observe' | 'control'; ttlSeconds?: number; tabIds?: string[]; operations?: string[] }
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
    credentials?: { leaseId: string; leaseToken: string }
  ): Promise<BrowserSessionView>;
  getOperation(operationId: string): Promise<BrowserOperationRecord>;
  downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer>;
}

export interface SemanticBrowserClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const PREFIX = '/api/v1/browser-execution';

export class SemanticBrowserClient implements SemanticBrowserClientPort {
  private readonly client: AxiosInstance;
  private readonly timeoutMs: number;

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
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.client = axios.create({
      baseURL: configured.replace(/\/$/, ''),
    });
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    return this.requestDirect(() =>
      this.client.get('/api/v1/capabilities', { timeout: this.timeoutMs, headers: headers() })
    );
  }

  async createSession(
    idempotencyKey: string,
    options: { headless?: false; viewport?: { width: number; height: number } } = {}
  ): Promise<BrowserSessionView> {
    return this.request(() =>
      this.client.post(`${PREFIX}/sessions`, options, {
        timeout: this.timeoutMs,
        headers: headers({ 'Idempotency-Key': idempotencyKey }),
      })
    );
  }

  async getSession(sessionId: string): Promise<BrowserSessionView> {
    return this.request(() =>
      this.client.get(`${PREFIX}/sessions/${encodeURIComponent(sessionId)}`, {
        timeout: this.timeoutMs,
        headers: headers(),
      })
    );
  }

  async listSessionEvents(
    sessionId: string,
    afterSeq = 0,
    limit = 500
  ): Promise<BrowserSessionEventRecord[]> {
    return this.request(() =>
      this.client.get(`${PREFIX}/sessions/${encodeURIComponent(sessionId)}/event-log`, {
        timeout: this.timeoutMs,
        headers: headers(),
        params: { afterSeq, limit },
      })
    );
  }

  async createLease(
    sessionId: string,
    idempotencyKey: string,
    input: { mode: 'observe' | 'control'; ttlSeconds?: number; tabIds?: string[]; operations?: string[] }
  ): Promise<IssuedBrowserLease> {
    return this.request(() =>
      this.client.post(`${PREFIX}/sessions/${encodeURIComponent(sessionId)}/leases`, input, {
        timeout: this.timeoutMs,
        headers: headers({ 'Idempotency-Key': idempotencyKey }),
      })
    );
  }

  async revokeLease(
    sessionId: string,
    leaseId: string,
    leaseToken: string,
    idempotencyKey: string
  ): Promise<BrowserLeaseView> {
    return this.request(() =>
      this.client.delete(
        `${PREFIX}/sessions/${encodeURIComponent(sessionId)}/leases/${encodeURIComponent(leaseId)}`,
        {
          timeout: this.timeoutMs,
          headers: headers({
            'Idempotency-Key': idempotencyKey,
            'X-Browser-Lease-ID': leaseId,
            Authorization: `Bearer ${leaseToken}`,
          }),
        }
      )
    );
  }

  async closeSession(
    sessionId: string,
    idempotencyKey: string,
    credentials?: { leaseId: string; leaseToken: string }
  ): Promise<BrowserSessionView> {
    return this.request(() =>
      this.client.delete(`${PREFIX}/sessions/${encodeURIComponent(sessionId)}`, {
        timeout: this.timeoutMs,
        headers: headers({
          'Idempotency-Key': idempotencyKey,
          ...(credentials
            ? {
                'X-Browser-Lease-ID': credentials.leaseId,
                Authorization: `Bearer ${credentials.leaseToken}`,
              }
            : {}),
        }),
      })
    );
  }

  async getOperation(operationId: string): Promise<BrowserOperationRecord> {
    return this.request(() =>
      this.client.get(`${PREFIX}/operations/${encodeURIComponent(operationId)}`, {
        timeout: this.timeoutMs,
        headers: headers(),
      })
    );
  }

  async downloadArtifact(sessionId: string, artifactId: string): Promise<Buffer> {
    try {
      const response = await this.client.get<ArrayBuffer>(
        `${PREFIX}/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { timeout: this.timeoutMs, headers: headers(), responseType: 'arraybuffer' }
      );
      return Buffer.from(response.data);
    } catch (error) {
      throw mapError(error);
    }
  }

  private async request<T>(work: () => Promise<{ data: { data: T } }>): Promise<T> {
    try {
      return (await work()).data.data;
    } catch (error) {
      throw mapError(error);
    }
  }

  private async requestDirect<T>(work: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await work()).data;
    } catch (error) {
      throw mapError(error);
    }
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Request-ID': randomUUID(), 'X-Correlation-ID': randomUUID(), ...extra };
}

function mapError(error: unknown): IntegrationClientError {
  if (error instanceof IntegrationClientError) return error;
  if (!isAxiosError(error)) {
    return new IntegrationClientError(
      'proxy-adapter',
      'dependency_unavailable',
      error instanceof Error ? error.message : 'proxy-adapter 请求失败',
      true
    );
  }
  const status = error.response?.status;
  const problem = error.response?.data as
    | { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> }
    | undefined;
  return new IntegrationClientError(
    'proxy-adapter',
    problem?.code ?? (status ? `http_${status}` : 'dependency_unavailable'),
    problem?.message ?? error.message,
    problem?.retryable ?? (!status || status >= 500),
    status,
    problem?.details
  );
}
