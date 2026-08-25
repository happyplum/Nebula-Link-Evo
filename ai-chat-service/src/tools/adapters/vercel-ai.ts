/**
 * Vercel AI SDK adapter — converts GatewayTool to Vercel tool() format.
 */
import { dynamicTool } from 'ai';
import { z } from 'zod';

import type { GatewayTool } from '../types.js';
import { jsonPropertyToZod } from './json-schema-to-zod.js';

// ---------------------------------------------------------------------------
// JSON Schema → Zod conversion (Vercel AI SDK wrapper)
// ---------------------------------------------------------------------------

function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (schema.type !== 'object' || !schema.properties) {
    return z.object({}).passthrough();
  }

  const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, property] of Object.entries(schema.properties as Record<string, unknown>)) {
    const zodProp = jsonPropertyToZod(property);
    shape[key] = required.has(key) ? zodProp : zodProp.optional();
  }

  return z.object(shape).passthrough();
}

// ---------------------------------------------------------------------------
// Safe execution wrapper
// ---------------------------------------------------------------------------

function safeExecute(
  fn: GatewayTool['execute'],
  swallowErrors: boolean
): (args: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<string> {
  return async (args, options) => {
    if (!swallowErrors) {
      return fn(args, {
        toolCallId: options.toolCallId,
        abortSignal: options.abortSignal,
      });
    }
    try {
      return await fn(args, {
        toolCallId: options.toolCallId,
        abortSignal: options.abortSignal,
      });
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
}

// ---------------------------------------------------------------------------
// GatewayTool → Vercel AI SDK tool
// ---------------------------------------------------------------------------

export function gatewayToolToVercelTool(
  gatewayTool: GatewayTool,
  options: { swallowErrors?: boolean } = {}
) {
  return dynamicTool({
    description: gatewayTool.description,
    inputSchema: jsonSchemaToZod(gatewayTool.inputSchema),
    execute: safeExecute(gatewayTool.execute, options.swallowErrors ?? true),
  });
}

export function gatewayToolsToVercelToolMap(
  tools: GatewayTool[],
  options: { swallowErrors?: boolean } = {}
): Record<string, ReturnType<typeof dynamicTool>> {
  const map: Record<string, ReturnType<typeof dynamicTool>> = {};
  for (const t of tools) {
    map[t.name] = gatewayToolToVercelTool(t, options);
  }
  return map;
}
