import { createHash } from 'node:crypto';
import type { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import { GATEWAY_MCP_SERVER_NAME } from '../config/service-config.js';
import type { GatewayTool } from '../tools/types.js';
import { AgentTaskError } from './errors.js';
import type {
  AgentTaskBrowserBinding,
  AgentTaskBrowserStep,
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
  mcpClient: Pick<MCPSDKClient, 'callTool'>;
}

export class BrowserToolWrapper {
  readonly summaries: AgentTaskToolCallSummary[] = [];
  private toolCallCount = 0;

  constructor(private readonly options: BrowserToolWrapperOptions) {}

  createTool(): GatewayTool {
    return {
      id: 'agent-task:browser-operation-execute',
      name: EXECUTE_TOOL,
      description:
        'Execute one pre-authorized browser step. Choose only stepId, target and operation arguments.',
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
          target: { type: 'object' },
          args: { type: 'object' },
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
        return JSON.stringify(await this.execute(args, toolCallId));
      },
    };
  }

  async execute(rawInput: unknown, toolCallId: string): Promise<BrowserOperationRecord> {
    this.options.beforeToolCall?.();
    this.consumeBudget();
    const input = requireObject(rawInput, 'Browser tool input');
    assertAllowedKeys(input, ['stepId', 'target', 'args'], 'Browser tool input');
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
      ...(input.target !== undefined ? { target: requireObject(input.target, 'target') } : {}),
      ...(input.args !== undefined ? { args: requireObject(input.args, 'args') } : {}),
      ...(step.capture ? { capture: step.capture } : {}),
      presentation: { animation: 'off' },
    };

    try {
      let operation: BrowserOperationRecord;
      try {
        operation = await this.callOperation(EXECUTE_TOOL, {
          sessionId: this.options.binding.browserSessionId,
          leaseId: this.options.binding.browserLeaseId,
          leaseToken: this.options.binding.browserLeaseToken,
          tabId: this.options.binding.tabId,
          request,
        });
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

  private async recoverOperation(
    operationId: string,
    executeError: unknown
  ): Promise<BrowserOperationRecord> {
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
    args: Record<string, unknown>
  ): Promise<BrowserOperationRecord> {
    const raw = await this.options.mcpClient.callTool(GATEWAY_MCP_SERVER_NAME, toolName, args);
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
