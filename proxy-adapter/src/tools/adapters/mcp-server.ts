/**
 * MCP Server adapter — registers GatewayTool instances on an McpServer.
 */
import { z } from 'zod';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayTool } from '../types.js';
import { jsonPropertyToZod } from './json-schema-to-zod.js';

// ---------------------------------------------------------------------------
// JSON Schema → Zod shape (for McpServer.tool() paramsSchema)
// ---------------------------------------------------------------------------

function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  if (schema.type !== 'object' || !schema.properties) {
    return {};
  }

  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(schema.properties as Record<string, unknown>)) {
    const zodProp = jsonPropertyToZod(property);
    shape[key] = required.has(key) ? zodProp : zodProp.optional();
  }

  return shape;
}

// ---------------------------------------------------------------------------
// Safe execution wrapper (MCP variant)
// ---------------------------------------------------------------------------

async function safeExecuteMcp(
  fn: (args: unknown) => Promise<string>,
  args: unknown
): Promise<{ text: string; isError: boolean }> {
  try {
    return { text: await fn(args), isError: false };
  } catch (error) {
    return { text: error instanceof Error ? error.message : String(error), isError: true };
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerGatewayToolsToMcpServer(server: McpServer, tools: GatewayTool[]): void {
  for (const gatewayTool of tools) {
    if (!gatewayTool.isAvailable) continue;

    const zodShape = jsonSchemaToZodShape(gatewayTool.inputSchema);

    server.tool(gatewayTool.name, gatewayTool.description, zodShape, async (args) => {
      const result = await safeExecuteMcp(gatewayTool.execute, args);
      return {
        content: [{ type: 'text' as const, text: result.text }],
        ...(result.isError ? { isError: true } : {}),
      };
    });
  }
}
