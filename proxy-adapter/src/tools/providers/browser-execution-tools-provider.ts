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
        request: { type: 'object', description: 'nebula.browser.operation/1.0 request' },
      },
      required: ['sessionId', 'leaseId', 'leaseToken', 'request'],
    },
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
      providerId: this.id,
      exposeTo: ['mcp-server'] as const,
      isAvailable: true,
      execute: async (rawArgs) => {
        try {
          return await this.executeTool(definition.name, rawArgs);
        } catch (error) {
          if (error instanceof BrowserExecutionError) {
            return JSON.stringify(toBrowserExecutionProblem(error));
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
