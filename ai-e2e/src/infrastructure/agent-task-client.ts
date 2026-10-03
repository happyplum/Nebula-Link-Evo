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
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';

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
    limit?: number
  ): Promise<AgentStreamEventV1[]>;
  commandTask(taskId: string, input: AgentTaskCommandRequest): Promise<AgentTaskCommandResult>;
}

export interface AgentTaskClientConfig {
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:3001';

export class AgentTaskClient implements AgentTaskClientPort {
  private readonly client: AxiosInstance;
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
    this.client = axios.create({
      baseURL: configured.replace(/\/$/, ''),
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

  async listTaskActivity(taskId: string, afterSeq = 0, limit = 500): Promise<AgentStreamEventV1[]> {
    const result = await this.request<unknown>(() =>
      this.client.get(`/api/v1/agent-tasks/${encodeURIComponent(taskId)}/activity-log`, {
        timeout: this.timeoutMs,
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
