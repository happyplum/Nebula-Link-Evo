import axios, { isAxiosError, type AxiosInstance } from 'axios';
import { randomUUID } from 'node:crypto';
import { IntegrationClientError } from './integration-client-error.js';
import type { BrowserTargetRefV1 } from '@nebula-link-evo/shared/types/browser-execution';

export type AgentTaskStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'blocked';

export interface AgentTaskBrowserStep {
  stepId: string;
  kind: 'observe' | 'act';
  operation: string;
  target?: BrowserTargetRefV1;
  args?: Record<string, unknown>;
  effectId?: string;
  maxAffectedItems?: number;
  capture?: {
    beforeScreenshot?: boolean;
    afterScreenshot?: boolean;
    domSnapshot?: boolean;
  };
}

export interface CreateAgentTaskInput {
  schema: 'nebula.ai.agent-task/1.0';
  clientTaskId: string;
  modelRole: 'decision';
  input: Record<string, unknown>;
  responseSchema: Record<string, unknown>;
  toolPolicy: {
    allow: string[];
    constraints?: Record<string, unknown>;
  };
  skillPolicy: {
    allow: Array<{ skillId: string; version: string; contentHash: string }>;
  };
  budgets: {
    maxDurationMs: number;
    maxModelTurns: number;
    maxToolCalls: number;
    maxTokens?: number;
  };
  browserBinding?: {
    browserSessionId: string;
    tabId: string;
    browserLeaseId: string;
    browserLeaseToken: string;
    browserLeaseSequence: number;
    access: 'observe' | 'control';
  };
  sideEffectAuthorization?: {
    contextType: 'run' | 'authoring';
    contextId: string;
    environment: 'local' | 'test' | 'staging' | 'production';
    policyVersion: string;
    policyEvaluationId: string;
    policyResult: 'auto_allowed' | 'approval_required';
    projectionSha256: string;
    effects: Array<{
      stepId: string;
      effectId: string;
      kind: 'create' | 'update' | 'delete' | 'auth_change';
      maxAffectedItems: number;
      reversibility: 'reversible' | 'compensatable' | 'irreversible';
    }>;
    grant?: { grantId: string; status: 'active'; approvedProjectionSha256: string };
  };
  correlation?: Record<string, string>;
}

export interface AgentTaskView {
  schema: 'nebula.ai.agent-task/1.0';
  taskId: string;
  clientTaskId: string;
  status: AgentTaskStatus;
  stateVersion: number;
  eventSeq: number;
  output?: unknown;
  error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
  terminationReason?: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    status: 'succeeded' | 'failed' | 'outcome_unknown';
    stepId?: string;
    operationId?: string;
    operation?: string;
    effectId?: string;
    errorCode?: string;
  }>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentTaskClientPort {
  getCapabilities(): Promise<Record<string, unknown>>;
  createTask(input: CreateAgentTaskInput, idempotencyKey: string): Promise<AgentTaskView>;
  getTask(taskId: string): Promise<AgentTaskView>;
  commandTask(
    taskId: string,
    input: {
      commandId: string;
      type: 'pause' | 'resume' | 'interrupt' | 'cancel';
      expectedStateVersion: number;
      reason?: string;
      createdBy?: string;
    }
  ): Promise<{ task: AgentTaskView }>;
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

  async createTask(input: CreateAgentTaskInput, idempotencyKey: string): Promise<AgentTaskView> {
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

  async commandTask(
    taskId: string,
    input: {
      commandId: string;
      type: 'pause' | 'resume' | 'interrupt' | 'cancel';
      expectedStateVersion: number;
      reason?: string;
      createdBy?: string;
    }
  ): Promise<{ task: AgentTaskView }> {
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
