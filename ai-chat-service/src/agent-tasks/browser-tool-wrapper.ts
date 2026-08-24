import { createHash } from 'node:crypto';
import type { HarnessMcpCaller } from '../harness/types.js';
import { GATEWAY_MCP_SERVER_NAME } from '../config/service-config.js';
import type { GatewayTool } from '../tools/types.js';
import { AgentTaskError } from './errors.js';
import type {
  AgentTaskBrowserBinding,
  AgentTaskBrowserStep,
  AgentTaskOperationReservation,
  AgentTaskToolCallSummary,
} from './types.js';

const EXECUTE_TOOL = 'browser-control.operation_execute';
const GET_TOOL = 'browser-control.operation_get';
const CANCEL_TOOL = 'browser-control.operation_cancel';
const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled', 'outcome_unknown']);

interface BrowserOperationRecord {
  operationId: string;
  status: string;
  operation?: string;
  actual?: unknown;
  resolvedTarget?: unknown;
  artifacts?: unknown[];
  error?: { code?: string; message?: string; retryable?: boolean };
}

export interface BrowserToolWrapperOptions {
  taskId: string;
  binding: AgentTaskBrowserBinding;
  steps: ReadonlyMap<string, AgentTaskBrowserStep>;
  deadlineAt: number;
  maxToolCalls: number;
  beforeToolCall?: () => void;
  consumeToolCall?: () => void;
  mcpClient: HarnessMcpCaller;
  authorizationSnapshot: Record<string, unknown>;
  persistOperation?: (operation: AgentTaskOperationReservation) => void;
  markOperationDispatched?: (toolCallId: string) => void;
  settleOperation?: (
    toolCallId: string,
    status: 'succeeded' | 'failed' | 'outcome_unknown',
    proxyStatus?: string
  ) => void;
}

export class BrowserToolWrapper {
  readonly summaries: AgentTaskToolCallSummary[] = [];
  private toolCallCount = 0;
  private readonly pendingOperationIds = new Set<string>();

  constructor(private readonly options: BrowserToolWrapperOptions) {}

  createTool(): GatewayTool {
    return {
      id: 'agent-task:browser-operation-execute',
      name: EXECUTE_TOOL,
      description: 'Execute one immutable pre-authorized browser step. Choose only its stepId.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stepId: {
            type: 'string',
            enum: Array.from(this.options.steps.keys()),
            description: Array.from(this.options.steps.values())
              .map((step) => `${step.stepId}: ${step.kind}/${step.operation}`)
              .join('; '),
          },
        },
        required: ['stepId'],
      },
      providerId: 'agent-task-browser-wrapper',
      exposeTo: ['chat'],
      isAvailable: true,
      execute: async (args, context) => {
        const toolCallId = context?.toolCallId;
        if (!toolCallId) {
          throw new AgentTaskError('execution_failed', 'Browser tool call is missing toolCallId');
        }
        return JSON.stringify(await this.execute(args, toolCallId, context.abortSignal));
      },
    };
  }

  async execute(
    rawInput: unknown,
    toolCallId: string,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    this.options.beforeToolCall?.();
    this.consumeBudget();
    const input = requireObject(rawInput, 'Browser tool input');
    assertAllowedKeys(input, ['stepId'], 'Browser tool input');
    const stepId = requireString(input.stepId, 'stepId');
    const step = this.options.steps.get(stepId);
    if (!step)
      throw new AgentTaskError('tool_not_allowed', `Browser step ${stepId} is not authorized`);
    const operationId = stableUuid(this.options.taskId, toolCallId, stepId);
    const summary: AgentTaskToolCallSummary = {
      toolCallId,
      toolName: EXECUTE_TOOL,
      status: 'failed',
      stepId,
      operationId,
      operation: step.operation,
      ...(step.effectId ? { effectId: step.effectId } : {}),
    };
    this.summaries.push(summary);

    const request = {
      schema: 'nebula.browser.operation/1.0',
      operationId,
      leaseSequence: this.options.binding.browserLeaseSequence,
      deadlineAt: new Date(Math.min(this.options.deadlineAt, Date.now() + 30_000)).toISOString(),
      kind: step.kind,
      operation: step.operation,
      ...(step.target ? { target: step.target } : {}),
      ...(step.args ? { args: step.args } : {}),
      ...(step.capture ? { capture: step.capture } : {}),
      presentation: { animation: 'off' },
    };
    const canonicalArgs = {
      stepId,
      ...(step.target ? { target: step.target } : {}),
      ...(step.args ? { args: step.args } : {}),
    };
    const browserBinding = {
      browserSessionId: this.options.binding.browserSessionId,
      tabId: this.options.binding.tabId,
      browserLeaseId: this.options.binding.browserLeaseId,
      browserLeaseSequence: this.options.binding.browserLeaseSequence,
      access: this.options.binding.access,
    };
    const requestHash = createHash('sha256')
      .update(stableStringify({ toolName: EXECUTE_TOOL, canonicalArgs, request, browserBinding }))
      .digest('hex');
    this.options.persistOperation?.({
      toolCallId,
      operationId,
      toolName: EXECUTE_TOOL,
      requestHash,
      canonicalArgs,
      quantity: {
        browserOperations: 1,
        affectedItems: 1,
        sideEffectUnits: step.kind === 'act' ? 1 : 0,
      },
      authorization: {
        ...this.options.authorizationSnapshot,
        step: {
          stepId: step.stepId,
          kind: step.kind,
          operation: step.operation,
          ...(step.effectId ? { effectId: step.effectId } : {}),
          maxAffectedItems: step.maxAffectedItems ?? 1,
          targetHash: step.target ? sha256(step.target) : null,
          argsHash: step.args ? sha256(step.args) : null,
        },
      },
      browserBinding,
    });

    let dispatchRecorded = false;
    try {
      let operation: BrowserOperationRecord;
      try {
        this.options.markOperationDispatched?.(toolCallId);
        dispatchRecorded = true;
        this.pendingOperationIds.add(operationId);
        operation = await this.callOperation(
          EXECUTE_TOOL,
          {
            sessionId: this.options.binding.browserSessionId,
            leaseId: this.options.binding.browserLeaseId,
            leaseToken: this.options.binding.browserLeaseToken,
            tabId: this.options.binding.tabId,
            request,
          },
          signal
        );
      } catch (executeError) {
        operation = await this.recoverOperation(operationId, executeError);
      }

      summary.status =
        operation.status === 'succeeded'
          ? 'succeeded'
          : operation.status === 'outcome_unknown'
            ? 'outcome_unknown'
            : 'failed';
      if (operation.error?.code) summary.errorCode = operation.error.code;
      this.options.settleOperation?.(
        toolCallId,
        operation.status === 'succeeded'
          ? 'succeeded'
          : operation.status === 'outcome_unknown'
            ? 'outcome_unknown'
            : 'failed',
        operation.status
      );
      this.pendingOperationIds.delete(operationId);
      return operation;
    } catch (error) {
      const taskError =
        error instanceof AgentTaskError
          ? error
          : new AgentTaskError('execution_failed', 'Browser operation failed', false, undefined, {
              cause: error,
            });
      summary.status = taskError.code === 'outcome_unknown' ? 'outcome_unknown' : 'failed';
      summary.errorCode = taskError.code;
      if (dispatchRecorded) {
        this.options.settleOperation?.(toolCallId, summary.status, summary.status);
      }
      if (taskError.code !== 'outcome_unknown') this.pendingOperationIds.delete(operationId);
      throw taskError;
    }
  }

  async cancel(operationId: string): Promise<BrowserOperationRecord> {
    return this.callOperation(CANCEL_TOOL, {
      operationId,
      sessionId: this.options.binding.browserSessionId,
      leaseId: this.options.binding.browserLeaseId,
      leaseToken: this.options.binding.browserLeaseToken,
    });
  }

  async cancelPending(): Promise<void> {
    const pending = [...this.pendingOperationIds];
    await Promise.allSettled(pending.map((operationId) => this.cancel(operationId)));
  }

  private async recoverOperation(
    operationId: string,
    executeError: unknown
  ): Promise<BrowserOperationRecord> {
    const deterministic = toDeterministicProxyError(executeError);
    if (deterministic) throw deterministic;
    try {
      const operation = await this.callOperation(GET_TOOL, { operationId });
      if (TERMINAL_STATUSES.has(operation.status)) return operation;
      throw new AgentTaskError(
        'outcome_unknown',
        `Browser operation ${operationId} is ${operation.status}; retry is unsafe`,
        true,
        { operationId, status: operation.status },
        { cause: executeError }
      );
    } catch (recoveryError) {
      if (recoveryError instanceof AgentTaskError && recoveryError.code === 'outcome_unknown') {
        throw recoveryError;
      }
      throw new AgentTaskError(
        'outcome_unknown',
        `Browser operation ${operationId} could not be recovered; retry is unsafe`,
        true,
        { operationId },
        { cause: executeError }
      );
    }
  }

  private async callOperation(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<BrowserOperationRecord> {
    const raw = signal
      ? await this.options.mcpClient.callTool(GATEWAY_MCP_SERVER_NAME, toolName, args, { signal })
      : await this.options.mcpClient.callTool(GATEWAY_MCP_SERVER_NAME, toolName, args);
    const parsed = extractParsedResult(raw);
    if (!parsed || typeof parsed.operationId !== 'string' || typeof parsed.status !== 'string') {
      throw new AgentTaskError(
        'dependency_unavailable',
        `${toolName} returned an invalid operation record`,
        true
      );
    }
    return parsed as unknown as BrowserOperationRecord;
  }

  private consumeBudget(): void {
    if (this.options.consumeToolCall) {
      this.options.consumeToolCall();
      return;
    }
    if (this.toolCallCount >= this.options.maxToolCalls) {
      throw new AgentTaskError('budget_exceeded', 'Agent task tool-call budget was exceeded');
    }
    this.toolCallCount += 1;
  }
}

function extractParsedResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.parsed && typeof record.parsed === 'object' && !Array.isArray(record.parsed)) {
    return record.parsed as Record<string, unknown>;
  }
  if (Array.isArray(record.content)) {
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
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return record;
}

function stableUuid(...parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(',')}}`;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function toDeterministicProxyError(error: unknown): AgentTaskError | null {
  const problem = extractProblem(error);
  if (!problem) return null;
  const proxyCode = String(problem.code);
  const code =
    proxyCode === 'validation_failed'
      ? 'validation_failed'
      : ['permission_denied', 'lease_expired'].includes(proxyCode)
        ? 'tool_not_allowed'
        : ['state_conflict', 'idempotency_conflict', 'browser_busy', 'not_found'].includes(
              proxyCode
            )
          ? 'conflict'
          : proxyCode === 'dependency_unavailable'
            ? 'dependency_unavailable'
            : null;
  if (!code) return null;
  return new AgentTaskError(
    code,
    typeof problem.message === 'string' ? problem.message : 'Proxy rejected browser operation',
    problem.retryable === true,
    {
      proxyCode,
      ...(typeof problem.correlationId === 'string'
        ? { correlationId: problem.correlationId }
        : {}),
    },
    { cause: error }
  );
}

function extractProblem(error: unknown): Record<string, unknown> | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  for (const candidate of [message, message.slice(message.indexOf('{'))]) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).code === 'string'
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // MCP implementations may prefix the structured problem with a tool error label.
    }
  }
  return null;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentTaskError('validation_failed', `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value)
    throw new AgentTaskError('validation_failed', `${label} is required`);
  return value;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length)
    throw new AgentTaskError('validation_failed', `${label} contains unknown fields`, false, {
      unknownFields: unknown,
    });
}
