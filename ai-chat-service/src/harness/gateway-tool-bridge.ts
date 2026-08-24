import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import { assertObjectJsonSchema, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { ToolRegistry } from '../tools/registry.js';
import type { GatewayTool } from '../tools/types.js';

const RAW_PROXY_OPERATIONS = new Set([
  'browser-control.operation_execute',
  'browser-control.operation_get',
  'browser-control.operation_cancel',
]);

export interface GatewayToolBridge {
  mappings(): ReadonlyMap<string, string>;
  dispose(): void;
}

/** Projects admitted Nebula product tools into the shared model-facing DSH registry. */
export function installGatewayToolBridge(
  context: Context,
  registry: ToolRegistry
): GatewayToolBridge {
  const generation = prepareGeneration(registry.getAvailableTools());
  const registrations: Array<() => void> = [];
  try {
    for (const definition of generation.definitions) {
      registrations.push(context.tools.register(definition));
    }
  } catch (error) {
    for (const dispose of registrations) dispose();
    throw error;
  }
  return {
    mappings: () => new Map(generation.mappings),
    dispose() {
      for (const dispose of registrations) dispose();
    },
  };
}

function prepareGeneration(tools: readonly GatewayTool[]): {
  definitions: ToolDefinition[];
  mappings: Map<string, string>;
} {
  const definitions: ToolDefinition[] = [];
  const mappings = new Map<string, string>();
  const safeNames = new Set<string>();
  for (const tool of tools) {
    if (RAW_PROXY_OPERATIONS.has(tool.name)) continue;
    const safeName = dshSafeToolName(tool.name);
    if (safeNames.has(safeName))
      throw new Error(`Product tool safe-name collision for ${tool.name}`);
    try {
      assertObjectJsonSchema(tool.inputSchema);
    } catch {
      continue;
    }
    safeNames.add(safeName);
    mappings.set(tool.name, safeName);
    definitions.push(toDshTool(tool, safeName));
  }
  return { definitions, mappings };
}

function toDshTool(tool: GatewayTool, name: string): ToolDefinition {
  return {
    name,
    description: tool.description,
    parameters: tool.inputSchema,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    timeoutMs: 30_000,
    execute: (args, exec) =>
      tool.execute(args, { toolCallId: String(exec.callId), abortSignal: exec.signal }),
  };
}

function dshSafeToolName(productName: string): string {
  const normalized = `nebula__${productName.replace(/[^A-Za-z0-9_-]+/gu, '__').replace(/-+/gu, '_')}`;
  if (normalized.length <= 64) return normalized;
  const hash = createHash('sha256').update(productName).digest('hex').slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}
