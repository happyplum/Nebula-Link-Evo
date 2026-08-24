/**
 * Shared JSON Schema → Zod conversion logic used by both Vercel AI and MCP adapters.
 */
import { z } from 'zod';

export interface JsonSchemaProperty {
  type?: string;
  const?: unknown;
  enum?: unknown[];
  items?: unknown;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
  anyOf?: unknown[];
  oneOf?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
}

export function jsonPropertyToZod(prop: unknown): z.ZodTypeAny {
  if (!prop || typeof prop !== 'object') return z.unknown();

  const def = prop as JsonSchemaProperty;

  const alternatives = def.oneOf ?? def.anyOf;
  if (alternatives) {
    if (alternatives.length < 1) throw new Error('JSON Schema union must not be empty');
    const schemas = alternatives.map(jsonPropertyToZod);
    return schemas.length === 1
      ? schemas[0]
      : z.union(schemas as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (def.const !== undefined) return z.literal(def.const as string | number | boolean | null);

  if (
    Array.isArray(def.enum) &&
    def.enum.length > 0 &&
    def.enum.every((v) => typeof v === 'string')
  ) {
    return z.string().refine((v) => (def.enum as string[]).includes(v), {
      message: `Expected one of: ${(def.enum as string[]).join(', ')}`,
    });
  }

  switch (def.type) {
    case 'string': {
      let schema = z.string();
      if (def.minLength !== undefined) schema = schema.min(def.minLength);
      if (def.maxLength !== undefined) schema = schema.max(def.maxLength);
      if (def.pattern !== undefined) schema = schema.regex(new RegExp(def.pattern, 'u'));
      return schema;
    }
    case 'number':
    case 'integer': {
      let schema = def.type === 'integer' ? z.number().int() : z.number();
      if (def.minimum !== undefined) schema = schema.min(def.minimum);
      if (def.maximum !== undefined) schema = schema.max(def.maximum);
      return schema;
    }
    case 'boolean':
      return z.boolean();
    case 'array':
      return z.array(jsonPropertyToZod(def.items));
    case 'object':
      if (def.properties) {
        const required = new Set(def.required ?? []);
        const shape = Object.fromEntries(
          Object.entries(def.properties).map(([key, value]) => {
            const schema = jsonPropertyToZod(value);
            return [key, required.has(key) ? schema : schema.optional()];
          })
        );
        const object = z.object(shape);
        if (def.additionalProperties === false) return object.strict();
        if (def.additionalProperties && typeof def.additionalProperties === 'object') {
          return object.catchall(jsonPropertyToZod(def.additionalProperties));
        }
        return object.passthrough();
      }
      if (def.additionalProperties === false) return z.object({}).strict();
      return z.record(
        z.string(),
        def.additionalProperties && typeof def.additionalProperties === 'object'
          ? jsonPropertyToZod(def.additionalProperties)
          : z.unknown()
      );
    default:
      return z.unknown();
  }
}
