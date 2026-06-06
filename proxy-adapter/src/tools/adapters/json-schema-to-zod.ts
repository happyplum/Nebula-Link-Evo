/**
 * Shared JSON Schema → Zod conversion logic used by both Vercel AI and MCP adapters.
 */
import { z } from 'zod';

export interface JsonSchemaProperty {
  type?: string;
  enum?: unknown[];
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
}

export function jsonPropertyToZod(prop: unknown): z.ZodTypeAny {
  if (!prop || typeof prop !== 'object') return z.unknown();

  const def = prop as JsonSchemaProperty;

  if (Array.isArray(def.enum) && def.enum.length > 0 && def.enum.every((v) => typeof v === 'string')) {
    return z.string().refine((v) => (def.enum as string[]).includes(v), {
      message: `Expected one of: ${(def.enum as string[]).join(', ')}`,
    });
  }

  switch (def.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(jsonPropertyToZod(def.items));
    case 'object':
      return z.record(z.string(), z.unknown());
    default:
      return z.unknown();
  }
}
