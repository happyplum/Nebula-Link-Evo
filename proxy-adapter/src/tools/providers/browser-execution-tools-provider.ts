import { EventEmitter } from 'node:events';
import type { BrowserExecutionService } from '../../browser-execution/service.js';
import {
  BrowserExecutionError,
  toBrowserExecutionProblem,
} from '../../browser-execution/errors.js';
import type {
  BrowserExecutionCredentials,
  BrowserOperationRequestV1,
  ExecuteBrowserOperationInput,
} from '../../browser-execution/types.js';
import type { GatewayTool, ToolProvider, ToolProviderStatus } from '../types.js';

const DEFINITIONS: ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: GatewayTool['inputSchema'];
  outputSchema: NonNullable<GatewayTool['outputSchema']>;
}> = [
  {
    name: 'browser-control.operation_execute',
    description: 'Execute one lease-bounded, durable and idempotent browser operation',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'Injected browser execution session ID' },
        leaseId: { type: 'string', description: 'Injected browser lease ID' },
        leaseToken: { type: 'string', description: 'Injected opaque browser lease token' },
        tabId: { type: 'string', description: 'Injected stable browser tab ID' },
        request: {
          type: 'object',
          additionalProperties: false,
          properties: {
            schema: { const: 'nebula.browser.operation/1.0' },
            operationId: { type: 'string' },
            leaseSequence: { type: 'integer' },
            deadlineAt: { type: 'string' },
            kind: { type: 'string', enum: ['observe', 'act'] },
            operation: { type: 'string' },
            target: targetSchema(),
            args: { type: 'object' },
            capture: {
              type: 'object',
              additionalProperties: false,
              properties: {
                beforeScreenshot: { type: 'boolean' },
                afterScreenshot: { type: 'boolean' },
                domSnapshot: { type: 'boolean' },
                videoSegment: { type: 'boolean' },
              },
            },
            presentation: {
              type: 'object',
              additionalProperties: false,
              properties: {
                label: { type: 'string' },
                animation: { type: 'string', enum: ['normal', 'fast', 'off'] },
              },
              required: ['animation'],
            },
          },
          required: ['schema', 'operationId', 'leaseSequence', 'deadlineAt', 'kind', 'operation'],
        },
      },
      required: ['sessionId', 'leaseId', 'leaseToken', 'request'],
    },
    outputSchema: operationRecordSchema(),
  },
  {
    name: 'browser-control.operation_get',
    description:
      'Query a durable browser operation result before deciding whether recovery is safe',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operationId: { type: 'string', description: 'Browser operation ID' },
      },
      required: ['operationId'],
    },
    outputSchema: operationRecordSchema(),
  },
  {
    name: 'browser-control.operation_cancel',
    description: 'Cancel a browser operation only while it is still queued',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operationId: { type: 'string', description: 'Browser operation ID' },
        sessionId: { type: 'string', description: 'Injected browser execution session ID' },
        leaseId: { type: 'string', description: 'Injected browser lease ID' },
        leaseToken: { type: 'string', description: 'Injected opaque browser lease token' },
      },
      required: ['operationId', 'sessionId', 'leaseId', 'leaseToken'],
    },
    outputSchema: operationRecordSchema(),
  },
];

export class BrowserExecutionToolsProvider extends EventEmitter implements ToolProvider {
  readonly id = 'browser-execution-tools';
  status: ToolProviderStatus = 'initializing';
  private tools: GatewayTool[] = [];

  constructor(private readonly service: BrowserExecutionService) {
    super();
  }

  async initialize(): Promise<void> {
    this.tools = DEFINITIONS.map((definition) => ({
      id: `${this.id}:${definition.name}`,
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      outputSchema: definition.outputSchema,
      providerId: this.id,
      isAvailable: true,
      execute: async (rawArgs) => {
        try {
          return await this.executeTool(definition.name, rawArgs);
        } catch (error) {
          if (error instanceof BrowserExecutionError) {
            throw new Error(JSON.stringify(toBrowserExecutionProblem(error)), { cause: error });
          }
          throw error;
        }
      },
    }));
    this.status = 'ready';
    this.emit('status-changed', 'ready');
  }

  getTools(): GatewayTool[] {
    return this.tools;
  }

  async shutdown(): Promise<void> {
    this.tools = [];
    this.status = 'disabled';
    this.emit('status-changed', 'disabled');
  }

  private async executeTool(name: string, rawArgs: unknown): Promise<string> {
    const args = requireObject(rawArgs);
    switch (name) {
      case 'browser-control.operation_execute': {
        assertAllowedKeys(args, ['sessionId', 'leaseId', 'leaseToken', 'tabId', 'request']);
        const input = {
          sessionId: requireString(args, 'sessionId'),
          leaseId: requireString(args, 'leaseId'),
          leaseToken: requireString(args, 'leaseToken'),
          ...(typeof args.tabId === 'string' ? { tabId: args.tabId } : {}),
          request: requireObject(args.request) as unknown as BrowserOperationRequestV1,
        } satisfies ExecuteBrowserOperationInput;
        return JSON.stringify(await this.service.executeOperation(input));
      }
      case 'browser-control.operation_get':
        assertAllowedKeys(args, ['operationId']);
        return JSON.stringify(this.service.getOperation(requireString(args, 'operationId')));
      case 'browser-control.operation_cancel': {
        assertAllowedKeys(args, ['operationId', 'sessionId', 'leaseId', 'leaseToken']);
        const credentials: BrowserExecutionCredentials = {
          sessionId: requireString(args, 'sessionId'),
          leaseId: requireString(args, 'leaseId'),
          leaseToken: requireString(args, 'leaseToken'),
        };
        return JSON.stringify(
          this.service.cancelOperation(requireString(args, 'operationId'), credentials)
        );
      }
      default:
        throw new Error(`Unknown browser execution tool: ${name}`);
    }
  }
}

function operationRecordSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      schema: { const: 'nebula.browser.operation-result/1.0' },
      operationId: { type: 'string' },
      requestHash: { type: 'string' },
      sessionId: { type: 'string' },
      leaseId: { type: 'string' },
      leaseSequence: { type: 'integer' },
      tabId: { type: 'string' },
      kind: { type: 'string', enum: ['observe', 'act'] },
      operation: { type: 'string' },
      status: {
        type: 'string',
        enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown'],
      },
      queueSequence: { type: 'integer' },
      acceptedAt: { type: 'string' },
      startedAt: { type: 'string' },
      completedAt: { type: 'string' },
      resolvedTarget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          semantic: { type: 'string' },
          strategy: {
            type: 'string',
            enum: ['role', 'test_id', 'label', 'placeholder', 'text', 'css', 'xpath'],
          },
          candidateIndex: { type: 'integer', minimum: 0 },
          matchedCount: { type: 'integer', minimum: 0 },
        },
        required: ['semantic', 'strategy', 'candidateIndex', 'matchedCount'],
      },
      actual: {},
      artifacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            kind: { type: 'string' },
            sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
            mimeType: { type: 'string' },
            sizeBytes: { type: 'integer', minimum: 1 },
            snapshotId: { type: 'string', minLength: 1 },
          },
          required: ['id', 'kind', 'sha256', 'mimeType', 'sizeBytes'],
        },
      },
      error: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          retryable: { type: 'boolean' },
          correlationId: { type: 'string' },
          details: { type: 'object' },
        },
        required: ['code', 'message', 'retryable', 'correlationId'],
      },
    },
    required: [
      'schema',
      'operationId',
      'requestHash',
      'sessionId',
      'leaseId',
      'leaseSequence',
      'kind',
      'operation',
      'status',
      'queueSequence',
      'acceptedAt',
      'artifacts',
    ],
  };
}

function targetSchema(): Record<string, unknown> {
  const valueCandidate = (strategy: string, exact: boolean): Record<string, unknown> => ({
    type: 'object',
    additionalProperties: false,
    properties: {
      strategy: { const: strategy },
      value: { type: 'string', minLength: 1, maxLength: 2_000 },
      ...(exact ? { exact: { type: 'boolean' } } : {}),
    },
    required: ['strategy', 'value'],
  });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      semantic: { type: 'string', minLength: 1, maxLength: 500 },
      candidates: {
        type: 'array',
        items: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              properties: {
                strategy: { const: 'role' },
                role: { type: 'string', minLength: 1 },
                name: { type: 'string' },
                exact: { type: 'boolean' },
              },
              required: ['strategy', 'role'],
            },
            valueCandidate('test_id', false),
            valueCandidate('label', true),
            valueCandidate('placeholder', true),
            valueCandidate('text', true),
            valueCandidate('css', false),
            valueCandidate('xpath', false),
          ],
        },
      },
      expected: {
        type: 'object',
        additionalProperties: false,
        properties: {
          cardinality: { type: 'string', enum: ['exactly_one', 'at_least_one', 'zero_or_one'] },
          visible: { type: 'boolean' },
          enabled: { type: 'boolean' },
          editable: { type: 'boolean' },
        },
        required: ['cardinality'],
      },
    },
    required: ['semantic', 'candidates', 'expected'],
  };
}

function requireObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  return value as Record<string, unknown>;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result) {
    throw new Error(`${key} is required`);
  }
  return result;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`Unexpected browser execution tool fields: ${unknown.join(', ')}`);
  }
}
