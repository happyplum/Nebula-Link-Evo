import { createHash } from 'node:crypto';
import {
  ACT_OPERATIONS,
  OBSERVE_OPERATIONS,
} from '@nebula-link-evo/shared/types/browser-execution';
import { AgentTaskError } from './errors.js';
import type {
  AgentTaskBrowserStep,
  CreateAgentTaskRequest,
  PersistedAgentTaskRequest,
} from '@nebula-link-evo/shared/types/agent-task';

const CONTROLLED_EXECUTE_TOOL = 'browser-control.operation_execute';
const CONTROLLED_INTERNAL_TOOLS = new Set([
  'browser-control.operation_get',
  'browser-control.operation_cancel',
]);
const OBSERVE_OPERATION_SET = new Set<string>(
  OBSERVE_OPERATIONS.filter((operation) => operation !== 'dom_snapshot')
);
const ACT_OPERATION_SET = new Set<string>(ACT_OPERATIONS);
const SENSITIVE_KEY =
  /^(?:password|token|api[_-]?key|authorization|cookie|secret|access[_-]?token|browserLeaseToken)$/i;
const SCHEMA_KEYS = new Set([
  '$schema',
  'type',
  'title',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'const',
  'additionalProperties',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

export const AGENT_TASK_LIMITS = Object.freeze({
  requestBytes: 128 * 1024,
  responseSchemaBytes: 32 * 1024,
  responseSchemaDepth: 8,
  maxDurationMs: 10 * 60 * 1000,
  maxModelTurns: 20,
  maxToolCalls: 50,
  maxTokens: 64_000,
  maxAllowedTools: 32,
  maxBrowserSteps: 100,
  maxSkillsPerTask: 1,
});

export interface ValidatedAgentTaskRequest {
  request: CreateAgentTaskRequest;
  browserSteps: ReadonlyMap<string, AgentTaskBrowserStep>;
  persistedRequest: PersistedAgentTaskRequest;
  requestHash: string;
}

export function validateCreateAgentTaskRequest(
  request: CreateAgentTaskRequest
): ValidatedAgentTaskRequest {
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > AGENT_TASK_LIMITS.requestBytes) {
    fail('Agent task request exceeds the size limit');
  }
  validateNoInlineSecrets(request.input, 'input');
  const responseSchema = validateResponseSchema(request.responseSchema);
  validateBudgets(request.budgets);
  const skillAllow = validateSkillPolicy(request.skillPolicy);
  if (request.correlation && Object.keys(request.correlation).length > 20)
    fail('correlation contains too many entries');

  if (request.toolPolicy.allow.length > AGENT_TASK_LIMITS.maxAllowedTools) {
    fail(`toolPolicy.allow must contain at most ${AGENT_TASK_LIMITS.maxAllowedTools} tools`);
  }
  const allow = request.toolPolicy.allow;
  if (new Set(allow).size !== allow.length) fail('toolPolicy.allow must not contain duplicates');
  if (allow.some((tool) => tool.includes('*'))) fail('toolPolicy.allow does not support wildcards');
  if (allow.some((tool) => CONTROLLED_INTERNAL_TOOLS.has(tool))) {
    fail('operation_get and operation_cancel are internal recovery tools');
  }
  if (
    allow.some((tool) => tool.startsWith('browser-control.') && tool !== CONTROLLED_EXECUTE_TOOL)
  ) {
    fail('Unsupported browser-control tools are not available to Agent tasks');
  }

  const browserBinding = request.browserBinding;
  const browserSteps = validateBrowserSteps(
    request.toolPolicy.constraints,
    allow,
    browserBinding?.access
  );
  validateSideEffectAuthorization(
    request.sideEffectAuthorization,
    browserSteps,
    request.correlation
  );
  const normalized: CreateAgentTaskRequest = {
    ...request,
    responseSchema,
    toolPolicy: {
      allow,
      ...(request.toolPolicy.constraints ? { constraints: request.toolPolicy.constraints } : {}),
    },
    skillPolicy: { allow: skillAllow },
    ...(browserBinding ? { browserBinding } : {}),
  };
  const persistedRequest = redactAgentTaskRequest(normalized);
  const hashInput = browserBinding
    ? {
        ...persistedRequest,
        browserBinding: {
          ...persistedRequest.browserBinding,
          browserLeaseTokenHash: sha256(browserBinding.browserLeaseToken),
        },
      }
    : persistedRequest;
  return {
    request: normalized,
    browserSteps,
    persistedRequest,
    requestHash: sha256(stableStringify(hashInput)),
  };
}

function validateSideEffectAuthorization(
  raw: CreateAgentTaskRequest['sideEffectAuthorization'],
  steps: ReadonlyMap<string, AgentTaskBrowserStep>,
  correlation?: Record<string, string>
): void {
  const effectSteps = [...steps.values()].filter((step) => step.effectId);
  if (effectSteps.length === 0) {
    if (raw !== undefined) fail('sideEffectAuthorization is only allowed for effect-bearing steps');
    return;
  }
  if (!raw) fail('sideEffectAuthorization is required for effect-bearing steps');
  const value = raw;
  if (value.contextType === 'run' && correlation?.runId !== value.contextId) {
    fail('sideEffectAuthorization context does not match correlation.runId');
  }
  if (value.effects.length !== effectSteps.length)
    fail('sideEffectAuthorization.effects must exactly cover authorized effect steps');
  const byStep = new Map<string, (typeof value.effects)[number]>();
  for (const effect of value.effects) {
    const record = effect;
    if (byStep.has(record.stepId)) fail(`Duplicate side-effect authorization for ${record.stepId}`);
    if (record.maxAffectedItems > 1_000)
      fail(`Side-effect ${record.stepId}.maxAffectedItems must be at most 1000`);
    byStep.set(record.stepId, record);
  }
  for (const step of effectSteps) {
    const effect = byStep.get(step.stepId);
    if (
      !effect ||
      effect.effectId !== step.effectId ||
      effect.maxAffectedItems !== step.maxAffectedItems
    )
      fail(`Side-effect authorization does not match browser step ${step.stepId}`);
    if (value.environment === 'production' && effect.kind !== 'auth_change')
      fail('Production business writes are not authorized');
  }
  const highRisk = value.effects.some(
    (effect) =>
      effect.kind === 'delete' ||
      effect.maxAffectedItems > 1 ||
      effect.reversibility === 'irreversible' ||
      effect.usesFileUpload === true
  );
  if (value.environment === 'staging' && highRisk) {
    const grant = value.grant;
    if (!grant || grant.approvedProjectionSha256 !== value.projectionSha256)
      fail('Staging high-risk grant is inactive or stale');
  } else if (value.policyResult !== 'auto_allowed') {
    fail('Non-high-risk task requires an auto_allowed policy evaluation');
  }
}

export function redactAgentTaskRequest(request: CreateAgentTaskRequest): PersistedAgentTaskRequest {
  if (!request.browserBinding) return { ...request };
  const { browserLeaseToken: _secret, ...safeBinding } = request.browserBinding;
  return { ...request, browserBinding: safeBinding };
}

export function validateResponseValue(
  schema: Record<string, unknown>,
  value: unknown,
  path = '$'
): void {
  if ('const' in schema && !deepEqual(value, schema.const))
    fail(`Response ${path} does not match const`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => deepEqual(entry, value))) {
    fail(`Response ${path} is not in enum`);
  }
  const type = schema.type;
  if (typeof type !== 'string') fail(`Response schema ${path} must declare type`);
  const validType =
    (type === 'object' && isPlainObject(value)) ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (type === 'integer' && Number.isInteger(value)) ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'null' && value === null);
  if (!validType) fail(`Response ${path} must be ${type}`);

  if (type === 'object') {
    const record = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) if (!(key in record)) fail(`Response ${path}.${key} is required`);
    for (const [key, child] of Object.entries(record)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) fail(`Response ${path}.${key} is not allowed`);
        continue;
      }
      validateResponseValue(childSchema, child, `${path}.${key}`);
    }
  } else if (type === 'array') {
    const items = schema.items as Record<string, unknown>;
    const array = value as unknown[];
    validateRange(array.length, schema.minItems, schema.maxItems, `Response ${path} item count`);
    array.forEach((entry, index) => validateResponseValue(items, entry, `${path}[${index}]`));
  } else if (type === 'string') {
    validateRange(
      (value as string).length,
      schema.minLength,
      schema.maxLength,
      `Response ${path} length`
    );
  } else if (type === 'number' || type === 'integer') {
    validateRange(value as number, schema.minimum, schema.maximum, `Response ${path}`);
  }
}

export function validateBoundedObjectSchema(value: unknown): Record<string, unknown> {
  return validateResponseSchema(structuredClone(requireObject(value, 'responseSchema')));
}

function validateResponseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (Buffer.byteLength(JSON.stringify(schema), 'utf8') > AGENT_TASK_LIMITS.responseSchemaBytes) {
    fail('responseSchema exceeds the size limit');
  }
  validateSchemaNode(schema, '$', 1);
  if (schema.type !== 'object') fail('responseSchema root type must be object');
  return schema;
}

function validateSchemaNode(schema: Record<string, unknown>, path: string, depth: number): void {
  if (depth > AGENT_TASK_LIMITS.responseSchemaDepth) fail('responseSchema exceeds the depth limit');
  const unknown = Object.keys(schema).filter((key) => !SCHEMA_KEYS.has(key));
  if (unknown.length)
    fail(`responseSchema ${path} uses unsupported keywords`, { unknownFields: unknown });
  if (
    !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(
      String(schema.type)
    )
  ) {
    fail(`responseSchema ${path} has an unsupported type`);
  }
  if (
    schema.enum !== undefined &&
    (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > 100)
  ) {
    fail(`responseSchema ${path}.enum is invalid`);
  }
  if (schema.type === 'object') {
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
      fail(`responseSchema ${path}.additionalProperties must be false`);
    }
    schema.additionalProperties = false;
    const properties = requireObject(schema.properties ?? {}, `responseSchema ${path}.properties`);
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some((key) => typeof key !== 'string')) {
      fail(`responseSchema ${path}.required must be a string array`);
    }
    for (const key of required as string[])
      if (!(key in properties)) fail(`responseSchema ${path} requires unknown property ${key}`);
    for (const [key, child] of Object.entries(properties)) {
      requireBoundedString(key, `responseSchema ${path} property name`, 1, 100);
      validateSchemaNode(
        requireObject(child, `responseSchema ${path}.${key}`),
        `${path}.${key}`,
        depth + 1
      );
    }
  }
  if (schema.type === 'array') {
    validateSchemaNode(
      requireObject(schema.items, `responseSchema ${path}.items`),
      `${path}[]`,
      depth + 1
    );
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    if (
      schema[key] !== undefined &&
      (!Number.isInteger(schema[key]) || (schema[key] as number) < 0)
    ) {
      fail(`responseSchema ${path}.${key} must be a non-negative integer`);
    }
  }
  for (const key of ['minimum', 'maximum'] as const) {
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))
    ) {
      fail(`responseSchema ${path}.${key} must be a finite number`);
    }
  }
}

function validateBudgets(budgets: CreateAgentTaskRequest['budgets']): void {
  for (const [key, min] of [
    ['maxDurationMs', 1_000],
    ['maxModelTurns', 1],
    ['maxToolCalls', 0],
    ['maxTokens', 1],
  ] as const) {
    const value = budgets[key];
    if (value !== undefined && (value < min || value > AGENT_TASK_LIMITS[key]))
      fail(`budgets.${key} must be an integer between ${min} and ${AGENT_TASK_LIMITS[key]}`);
  }
}

function validateSkillPolicy(
  policy: CreateAgentTaskRequest['skillPolicy']
): CreateAgentTaskRequest['skillPolicy']['allow'] {
  if (policy.allow.length > AGENT_TASK_LIMITS.maxSkillsPerTask)
    fail(`skillPolicy.allow supports at most ${AGENT_TASK_LIMITS.maxSkillsPerTask} Skill`);
  if (new Set(policy.allow.map((pin) => pin.skillId)).size !== policy.allow.length)
    fail('skillPolicy.allow must not contain duplicate Skill ids');
  return policy.allow;
}

function validateBrowserSteps(
  rawConstraints: CreateAgentTaskRequest['toolPolicy']['constraints'],
  allow: readonly string[],
  access: 'observe' | 'control' | undefined
): ReadonlyMap<string, AgentTaskBrowserStep> {
  const executeAllowed = allow.includes(CONTROLLED_EXECUTE_TOOL);
  if (!executeAllowed) {
    if (rawConstraints !== undefined && Object.keys(rawConstraints).length > 0) {
      fail('Tool constraints are only implemented for browser-control.operation_execute');
    }
    return new Map();
  }
  if (!access) fail('browserBinding is required when operation_execute is allowed');
  const executeConstraints = rawConstraints?.[CONTROLLED_EXECUTE_TOOL];
  if (
    !executeConstraints ||
    executeConstraints.steps.length === 0 ||
    executeConstraints.steps.length > AGENT_TASK_LIMITS.maxBrowserSteps
  ) {
    fail(`Browser steps must contain between 1 and ${AGENT_TASK_LIMITS.maxBrowserSteps} entries`);
  }
  const result = new Map<string, AgentTaskBrowserStep>();
  for (const step of executeConstraints.steps) {
    if (result.has(step.stepId)) fail(`Duplicate browser stepId: ${step.stepId}`);
    const operations =
      step.kind === 'observe'
        ? OBSERVE_OPERATION_SET
        : step.kind === 'act'
          ? ACT_OPERATION_SET
          : undefined;
    if (!operations?.has(step.operation))
      fail(`Browser step ${step.stepId} kind and operation do not match`);
    if (access === 'observe' && step.kind === 'act')
      fail(`Observe binding cannot authorize act step ${step.stepId}`);
    if (step.maxAffectedItems !== undefined && step.maxAffectedItems > 1)
      fail(`Browser step ${step.stepId}.maxAffectedItems must be an integer between 1 and 1`);
    if (step.capture?.videoSegment === true)
      fail('Browser operation video capture is not available');
    result.set(step.stepId, step);
  }
  return result;
}

function validateNoInlineSecrets(value: unknown, path: string, depth = 0): void {
  if (depth > 20) fail(`${path} exceeds the nesting limit`);
  if (Array.isArray(value))
    return value.forEach((entry, index) =>
      validateNoInlineSecrets(entry, `${path}[${index}]`, depth + 1)
    );
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key) && !key.endsWith('Ref'))
      fail(`${path}.${key} must be supplied as a secret reference`);
    validateNoInlineSecrets(child, `${path}.${key}`, depth + 1);
  }
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainObject(value)) fail(`${label} must be an object`);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireBoundedString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    fail(`${label} must be a string between ${min} and ${max} characters`);
  return value;
}

function validateRange(value: number, rawMin: unknown, rawMax: unknown, label: string): void {
  if (typeof rawMin === 'number' && value < rawMin) fail(`${label} must be at least ${rawMin}`);
  if (typeof rawMax === 'number' && value > rawMax) fail(`${label} must be at most ${rawMax}`);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(message: string, details?: Record<string, unknown>): never {
  throw new AgentTaskError('validation_failed', message, false, details);
}
