import type {
  BrowserExecutionCapabilities,
  BrowserExecutionCredentials,
  BrowserExecutionProblem,
  BrowserOperationRecord,
  BrowserOperationRequestV1,
  BrowserSessionOptions,
  BrowserSessionView,
  BrowserSuccessEnvelope,
  CreateBrowserLeaseRequest,
  IssuedBrowserLease,
} from '@nebula-link-evo/shared/types/browser-execution';
import { BrowserControlError } from './errors.js';
import { StreamableHttpMcpToolCaller, type McpToolCaller } from './mcp-tool-caller.js';

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';

export interface BrowserControlClientOptions {
  baseUrl?: string;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  mcpToolCaller?: McpToolCaller;
}

export class BrowserControlClient {
  readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly mcpToolCaller: McpToolCaller;

  constructor(options: BrowserControlClientOptions = {}) {
    this.baseUrl = normalizeLoopbackBaseUrl(
      options.baseUrl ?? process.env.PROXY_ADAPTER_URL ?? DEFAULT_BASE_URL
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    const mcpUrl = new URL('/mcp', this.baseUrl);
    this.mcpToolCaller = options.mcpToolCaller ?? new StreamableHttpMcpToolCaller(mcpUrl);
  }

  async getCapabilities(signal?: AbortSignal): Promise<BrowserExecutionCapabilities> {
    return this.request('/api/v1/capabilities', { signal });
  }

  async createSession(
    options: BrowserSessionOptions,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<BrowserSessionView> {
    return this.requestEnvelope('/api/v1/browser-execution/sessions', {
      method: 'POST',
      idempotencyKey,
      body: options,
      signal,
    });
  }

  async getSession(sessionId: string, signal?: AbortSignal): Promise<BrowserSessionView> {
    return this.requestEnvelope(
      `/api/v1/browser-execution/sessions/${encodeURIComponent(sessionId)}`,
      { signal }
    );
  }

  async closeSession(
    sessionId: string,
    credentials: BrowserExecutionCredentials,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<BrowserSessionView> {
    return this.requestEnvelope(
      `/api/v1/browser-execution/sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        credentials,
        idempotencyKey,
        signal,
      }
    );
  }

  async createLease(
    sessionId: string,
    request: CreateBrowserLeaseRequest,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<IssuedBrowserLease> {
    return this.requestEnvelope(
      `/api/v1/browser-execution/sessions/${encodeURIComponent(sessionId)}/leases`,
      { method: 'POST', body: request, idempotencyKey, signal }
    );
  }

  async revokeLease(
    credentials: BrowserExecutionCredentials,
    idempotencyKey: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    return this.requestEnvelope(
      `/api/v1/browser-execution/sessions/${encodeURIComponent(credentials.sessionId)}/leases/${encodeURIComponent(credentials.leaseId)}`,
      { method: 'DELETE', credentials, idempotencyKey, signal }
    );
  }

  async executeOperation(
    credentials: BrowserExecutionCredentials,
    tabId: string,
    request: BrowserOperationRequestV1,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    return this.callOperationTool(
      'browser-control.operation_execute',
      {
        sessionId: credentials.sessionId,
        leaseId: credentials.leaseId,
        leaseToken: credentials.leaseToken,
        tabId,
        request,
      },
      signal
    );
  }

  async getOperation(operationId: string, signal?: AbortSignal): Promise<BrowserOperationRecord> {
    return this.requestEnvelope(
      `/api/v1/browser-execution/operations/${encodeURIComponent(operationId)}`,
      { signal }
    );
  }

  async cancelOperation(
    operationId: string,
    credentials: BrowserExecutionCredentials,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    return this.callOperationTool(
      'browser-control.operation_cancel',
      {
        operationId,
        sessionId: credentials.sessionId,
        leaseId: credentials.leaseId,
        leaseToken: credentials.leaseToken,
      },
      signal
    );
  }

  async downloadArtifact(
    sessionId: string,
    artifactId: string,
    signal?: AbortSignal
  ): Promise<Uint8Array> {
    return this.request(
      `/api/v1/browser-execution/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}`,
      { signal, responseType: 'bytes' }
    );
  }

  async close(): Promise<void> {
    await this.mcpToolCaller.close();
  }

  private async callOperationTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    let raw: unknown;
    try {
      raw = await this.mcpToolCaller.callTool(name, args, signal);
    } catch (error) {
      throw new BrowserControlError(
        'dependency_unavailable',
        `proxy-adapter MCP request failed for ${name}`,
        true,
        undefined,
        undefined,
        { cause: error }
      );
    }
    const parsed = parseMcpToolJson(raw);
    if (isProblem(parsed)) throw BrowserControlError.fromProblem(parsed);
    if (!isOperationRecord(parsed)) {
      throw new BrowserControlError(
        'dependency_unavailable',
        `${name} returned an invalid operation record`,
        true
      );
    }
    return parsed;
  }

  private async requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const envelope = await this.request<BrowserSuccessEnvelope<T>>(path, options);
    if (!envelope || typeof envelope !== 'object' || !('data' in envelope)) {
      throw new BrowserControlError(
        'dependency_unavailable',
        `proxy-adapter returned an invalid envelope for ${path}`,
        true
      );
    }
    return envelope.data;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    if (options.credentials) {
      headers.set('Authorization', `Bearer ${options.credentials.leaseToken}`);
      headers.set('X-Browser-Lease-ID', options.credentials.leaseId);
    }

    const timeoutSignal = AbortSignal.timeout(this.requestTimeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.baseUrl), {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal,
      });
    } catch (error) {
      throw new BrowserControlError(
        'dependency_unavailable',
        `proxy-adapter request failed for ${path}`,
        true,
        undefined,
        undefined,
        { cause: error }
      );
    }

    if (!response.ok) {
      const problem = await readProblem(response);
      throw problem
        ? BrowserControlError.fromProblem(problem)
        : new BrowserControlError(
            'dependency_unavailable',
            `proxy-adapter returned HTTP ${response.status} for ${path}`,
            response.status >= 500
          );
    }
    if (options.responseType === 'bytes') {
      return new Uint8Array(await response.arrayBuffer()) as T;
    }
    return (await response.json()) as T;
  }
}

function isProblem(value: unknown): value is BrowserExecutionProblem {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string' &&
    typeof (value as { retryable?: unknown }).retryable === 'boolean' &&
    typeof (value as { correlationId?: unknown }).correlationId === 'string'
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  idempotencyKey?: string;
  credentials?: BrowserExecutionCredentials;
  signal?: AbortSignal;
  responseType?: 'json' | 'bytes';
}

function normalizeLoopbackBaseUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host)) {
    throw new BrowserControlError(
      'validation_failed',
      'Browser control v1 only supports loopback proxy-adapter URLs'
    );
  }
  url.pathname = url.pathname.replace(/\/$/, '');
  return url;
}

async function readProblem(response: Response): Promise<BrowserExecutionProblem | undefined> {
  try {
    const value = (await response.json()) as Partial<BrowserExecutionProblem>;
    return typeof value.code === 'string' && typeof value.message === 'string'
      ? {
          code: value.code,
          message: value.message,
          retryable: value.retryable === true,
          correlationId: value.correlationId ?? 'unknown',
          ...(value.details ? { details: value.details } : {}),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function parseMcpToolJson(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return record.structuredContent;
  }
  if (!Array.isArray(record.content)) return undefined;
  const text = record.content
    .filter(
      (item): item is { type: 'text'; text: string } =>
        Boolean(item) &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string'
    )
    .map((item) => item.text)
    .join('\n');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isOperationRecord(value: unknown): value is BrowserOperationRecord {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { operationId?: unknown }).operationId === 'string' &&
    typeof (value as { status?: unknown }).status === 'string'
  );
}
