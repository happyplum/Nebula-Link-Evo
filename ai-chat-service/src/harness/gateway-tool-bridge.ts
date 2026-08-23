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
  let current: Array<{ definition: ToolDefinition; dispose: () => void }> = [];
  let productToSafe = new Map<string, string>();
  let queued = false;

  const synchronize = (): void => {
    const next = prepareGeneration(registry.getAvailableTools({ consumer: 'chat' }));
    for (const entry of current) entry.dispose();
    const registered: typeof current = [];
    try {
      for (const definition of next.definitions) {
        registered.push({ definition, dispose: context.tools.register(definition) });
      }
      current = registered;
      productToSafe = next.mappings;
    } catch (error) {
      for (const entry of registered) entry.dispose();
      current = [];
      productToSafe = new Map();
      throw error;
    }
  };
  const onChanged = (): void => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      try {
        synchronize();
      } catch (error) {
        context.logger.error(`Gateway tool generation was quarantined: ${String(error)}`);
      }
    });
  };

  synchronize();
  registry.on('tools:changed', onChanged);
  return {
    mappings: () => new Map(productToSafe),
    dispose() {
      registry.removeListener('tools:changed', onChanged);
      for (const entry of current) entry.dispose();
      current = [];
      productToSafe = new Map();
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
    if (safeNames.has(safeName)) throw new Error(`Product tool safe-name collision for ${tool.name}`);
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
