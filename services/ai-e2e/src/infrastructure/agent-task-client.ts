import axios, { isAxiosError, type AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { IntegrationClientError } from './integration-client-error.js';
import type {
  CreateAgentTaskRequest,
  AgentTaskView,
  AgentTaskEventRecord,
  AgentTaskCommandRequest,
  AgentTaskCommandResult,
} from '@nebula-link-evo/shared/types/agent-task';
import {
  isAgentStreamEvent,
  isAgentStreamSnapshot,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';

export interface AgentTaskActivityStreamHandlers {
  onSnapshot(snapshot: AgentStreamSnapshotV1): void | Promise<void>;
  onEvent(event: AgentStreamEventV1): void;
}

export interface AgentTaskActivitySource {
  listTaskActivity(
    taskId: string,
    afterSeq?: number,
    limit?: number,
    signal?: AbortSignal
  ): Promise<AgentStreamEventV1[]>;
  streamTaskActivity(
    taskId: string,
    signal: AbortSignal,
    handlers: AgentTaskActivityStreamHandlers
  ): Promise<void>;
}

export interface AgentTaskClientPort {
  getCapabilities(): Promise<Record<string, unknown>>;
  createTask(input: CreateAgentTaskRequest, idempotencyKey: string): Promise<AgentTaskView>;
  getTask(taskId: string): Promise<AgentTaskView>;
  listTaskEvents?(
    taskId: string,
    afterSeq?: number,
    limit?: number
  ): Promise<AgentTaskEventRecord[]>;
  listTaskActivity?(
    taskId: string,
    afterSeq?: number,
    limit?: number,
    signal?: AbortSignal
  ): Promise<AgentStreamEventV1[]>;
  streamTaskActivity?(
    taskId: string,
    signal: AbortSignal,
    handlers: AgentTaskActivityStreamHandlers
  ): Promise<void>;
  commandTask(taskId: string, input: AgentTaskCommandRequest): Promise<AgentTaskCommandResult>;
}

export interface AgentTaskClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

export class AgentTaskClient implements AgentTaskClientPort {
  private readonly client: AxiosInstance;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: AgentTaskClientConfig = {}) {
    const configured = config.baseUrl ?? process.env.AI_CHAT_SERVICE_URL ?? DEFAULT_BASE_URL;
    if (!configured.trim()) {
      throw new IntegrationClientError(
        'ai-chat-service',
        'dependency_unavailable',
        'ai-chat-service 未配置',
        true
      );
    }
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.baseUrl = configured.replace(/\/$/, '');
    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async getCapabilities(): Promise<Record<string, unknown>> {
    return this.request(() =>
      this.client.get('/api/v1/capabilities', { timeout: this.timeoutMs, headers: headers() })
    );
  }

  async createTask(input: CreateAgentTaskRequest, idempotencyKey: string): Promise<AgentTaskView> {
    return this.request(() =>
      this.client.post('/api/v1/agent-tasks', input, {
        timeout: this.timeoutMs,
        headers: headers({ 'Idempotency-Key': idempotencyKey }),
      })
    );
  }

  async getTask(taskId: string): Promise<AgentTaskView> {
    return this.request(() =>
      this.client.get(`/api/v1/agent-tasks/${encodeURIComponent(taskId)}`, {
        timeout: this.timeoutMs,
        headers: headers(),
      })
    );
  }

  async listTaskEvents(taskId: string, afterSeq = 0, limit = 500): Promise<AgentTaskEventRecord[]> {
    return this.request(() =>
      this.client.get(`/api/v1/agent-tasks/${encodeURIComponent(taskId)}/event-log`, {
        timeout: this.timeoutMs,
        headers: headers(),
        params: { afterSeq, limit },
      })
    );
  }

  async listTaskActivity(
    taskId: string,
    afterSeq = 0,
    limit = 500,
    signal?: AbortSignal
  ): Promise<AgentStreamEventV1[]> {
    const result = await this.request<unknown>(() =>
      this.client.get(`/api/v1/agent-tasks/${encodeURIComponent(taskId)}/activity-log`, {
        timeout: this.timeoutMs,
        signal,
        headers: headers(),
        params: { afterSeq, limit },
      })
    );
    if (!Array.isArray(result) || !result.every(isAgentStreamEvent)) {
      throw new IntegrationClientError(
        'ai-chat-service',
        'invalid_response',
        'ai-chat-service returned an invalid Agent activity stream payload',
        false
      );
    }
    return result;
  }

  async streamTaskActivity(
    taskId: string,
    signal: AbortSignal,
    handlers: AgentTaskActivityStreamHandlers
  ): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/api/v1/agent-tasks/${encodeURIComponent(taskId)}/activity`,
        {
          headers: headers({ Accept: 'text/event-stream' }),
          signal,
        }
      );
    } catch (error) {
      if (signal.aborted) return;
      throw mapError(error);
    }

    if (!response.ok) {
      throw new IntegrationClientError(
        'ai-chat-service',
        `http_${response.status}`,
        'ai-chat-service Agent activity stream request failed',
        response.status >= 500,
        response.status
      );
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
      throw new IntegrationClientError(
        'ai-chat-service',
        'invalid_response',
        'ai-chat-service returned an invalid Agent activity stream content type',
        false,
        response.status
      );
    }
    if (!response.body) {
      throw new IntegrationClientError(
        'ai-chat-service',
        'invalid_response',
        'ai-chat-service returned an empty Agent activity stream',
        false,
        response.status
      );
    }

    await readAgentActivityStream(response.body, signal, handlers);
  }

  async commandTask(
    taskId: string,
    input: AgentTaskCommandRequest
  ): Promise<AgentTaskCommandResult> {
    return this.request(() =>
      this.client.post(`/api/v1/agent-tasks/${encodeURIComponent(taskId)}/commands`, input, {
        timeout: this.timeoutMs,
        headers: headers(),
      })
    );
  }

  private async request<T>(work: () => Promise<{ data: T }>): Promise<T> {
    try {
      return (await work()).data;
    } catch (error) {
      throw mapError(error);
    }
  }
}

async function readAgentActivityStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  handlers: AgentTaskActivityStreamHandlers
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });

      while (true) {
        const delimiter = /\r?\n\r?\n/u.exec(buffer);
        if (!delimiter || delimiter.index === undefined) break;
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        await dispatchAgentActivityFrame(frame, handlers);
        if (signal.aborted) return;
      }

      if (done) {
        if (buffer.trim()) await dispatchAgentActivityFrame(buffer, handlers);
        return;
      }
    }
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  } finally {
    if (signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function dispatchAgentActivityFrame(
  frame: string,
  handlers: AgentTaskActivityStreamHandlers
): Promise<void> {
  let eventName = '';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /u, '');
    if (field === 'event') eventName = value;
    if (field === 'data') data.push(value);
  }
  if (data.length === 0) return;

  let payload: unknown;
  try {
    payload = JSON.parse(data.join('\n')) as unknown;
  } catch (error) {
    throw new IntegrationClientError(
      'ai-chat-service',
      'invalid_response',
      'ai-chat-service returned invalid Agent activity stream JSON',
      false,
      undefined,
      undefined,
      undefined,
      { cause: error }
    );
  }

  if (eventName === 'agent_stream.snapshot' && isAgentStreamSnapshot(payload)) {
    await handlers.onSnapshot(payload);
    return;
  }
  if (eventName === 'agent_stream.event' && isAgentStreamEvent(payload)) {
    handlers.onEvent(payload);
    return;
  }
  throw new IntegrationClientError(
    'ai-chat-service',
    'invalid_response',
    `ai-chat-service returned an invalid ${eventName || 'unnamed'} Agent activity frame`,
    false
  );
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Request-ID': randomUUID(), ...extra };
}

function mapError(error: unknown): IntegrationClientError {
  if (error instanceof IntegrationClientError) return error;
  if (!isAxiosError(error)) {
    return new IntegrationClientError(
      'ai-chat-service',
      'dependency_unavailable',
      error instanceof Error ? error.message : 'ai-chat-service 请求失败',
      true
    );
  }
  const status = error.response?.status;
  const body = error.response?.data as
    | {
        error?: {
          code?: string;
          message?: string;
          retryable?: boolean;
          details?: Record<string, unknown>;
        };
      }
    | undefined;
  const problem = body?.error;
  return new IntegrationClientError(
    'ai-chat-service',
    problem?.code ?? (status ? `http_${status}` : 'dependency_unavailable'),
    problem?.message ?? error.message,
    problem?.retryable ?? (!status || status >= 500),
    status,
    problem?.details
  );
}
