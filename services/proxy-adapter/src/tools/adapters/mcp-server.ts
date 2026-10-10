/**
 * MCP Server adapter — registers GatewayTool instances on an McpServer.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GatewayTool } from '../types.js';
import { jsonPropertyToZod } from './json-schema-to-zod.js';

// ---------------------------------------------------------------------------
// JSON Schema → Zod shape (for McpServer.tool() paramsSchema)
// ---------------------------------------------------------------------------

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

    const inputSchema = jsonPropertyToZod(gatewayTool.inputSchema);
    const outputSchema = gatewayTool.outputSchema
      ? jsonPropertyToZod(gatewayTool.outputSchema)
      : undefined;

    server.registerTool(
      gatewayTool.name,
      {
        description: gatewayTool.description,
        inputSchema,
        ...(outputSchema ? { outputSchema } : {}),
      },
      async (args) => {
        const result = await safeExecuteMcp(gatewayTool.execute, args);
        if (!result.isError && outputSchema) {
          try {
            const structuredContent = outputSchema.parse(JSON.parse(result.text)) as Record<
              string,
              unknown
            >;
            return {
              content: [{ type: 'text' as const, text: result.text }],
              structuredContent,
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Invalid tool output: ${error instanceof Error ? error.message : String(error)}`,
                },
              ],
              isError: true,
            };
          }
        }
        return {
          content: [{ type: 'text' as const, text: result.text }],
          ...(result.isError ? { isError: true } : {}),
        };
      }
    );
  }
}
