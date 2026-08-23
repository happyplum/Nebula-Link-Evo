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
} from './types.js';
import { AGENT_TASK_SCHEMA } from './types.js';

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

export function validateCreateAgentTaskRequest(value: unknown): ValidatedAgentTaskRequest {
  const request = requireObject(value, 'Agent task request') as unknown as CreateAgentTaskRequest;
  assertAllowedKeys(
    request as unknown as Record<string, unknown>,
    [
      'schema',
      'clientTaskId',
      'modelRole',
      'input',
      'responseSchema',
      'toolPolicy',
      'skillPolicy',
      'budgets',
      'browserBinding',
      'correlation',
    ],
    'Agent task request'
  );
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > AGENT_TASK_LIMITS.requestBytes) {
    fail('Agent task request exceeds the size limit');
  }
  if (request.schema !== AGENT_TASK_SCHEMA) fail('Agent task schema is unsupported');
  requireBoundedString(request.clientTaskId, 'clientTaskId', 1, 128);
  if (request.modelRole !== 'decision') fail('modelRole must be decision');
  request.input = requireObject(request.input, 'input');
  validateNoInlineSecrets(request.input, 'input');
  const responseSchema = validateResponseSchema(request.responseSchema);
  validateBudgets(request.budgets);
  const skillAllow = validateSkillPolicy(request.skillPolicy);
  validateCorrelation(request.correlation);

  const toolPolicy = requireObject(request.toolPolicy, 'toolPolicy');
  assertAllowedKeys(toolPolicy, ['allow', 'constraints'], 'toolPolicy');
  if (
    !Array.isArray(request.toolPolicy.allow) ||
    request.toolPolicy.allow.length > AGENT_TASK_LIMITS.maxAllowedTools
  ) {
    fail(`toolPolicy.allow must contain at most ${AGENT_TASK_LIMITS.maxAllowedTools} tools`);
  }
  const allow = request.toolPolicy.allow.map((tool, index) =>
    requireBoundedString(tool, `toolPolicy.allow[${index}]`, 1, 200)
  );
  if (new Set(allow).size !== allow.length) fail('toolPolicy.allow must not contain duplicates');
  if (allow.some((tool) => tool.includes('*'))) fail('toolPolicy.allow does not support wildcards');
  if (allow.some((tool) => CONTROLLED_INTERNAL_TOOLS.has(tool))) {
    fail('operation_get and operation_cancel are internal recovery tools');
  }
  if (
    allow.some((tool) => tool.startsWith('browser-control.') && tool !== CONTROLLED_EXECUTE_TOOL)
  ) {
    fail('Legacy browser-control tools are not available to Agent tasks');
  }

  const browserBinding = validateBrowserBinding(request.browserBinding);
  const browserSteps = validateBrowserSteps(
    request.toolPolicy.constraints,
    allow,
    browserBinding?.access
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
  return validateResponseSchema(structuredClone(value));
}

function validateResponseSchema(value: unknown): Record<string, unknown> {
  const schema = requireObject(value, 'responseSchema');
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

function validateBudgets(value: unknown): void {
  const budgets = requireObject(value, 'budgets');
  assertAllowedKeys(
    budgets,
    ['maxDurationMs', 'maxModelTurns', 'maxToolCalls', 'maxTokens'],
    'budgets'
  );
  requireIntegerRange(
    budgets.maxDurationMs,
    'budgets.maxDurationMs',
    1_000,
    AGENT_TASK_LIMITS.maxDurationMs
  );
  requireIntegerRange(
    budgets.maxModelTurns,
    'budgets.maxModelTurns',
    1,
    AGENT_TASK_LIMITS.maxModelTurns
  );
  requireIntegerRange(
    budgets.maxToolCalls,
    'budgets.maxToolCalls',
    0,
    AGENT_TASK_LIMITS.maxToolCalls
  );
  if (budgets.maxTokens !== undefined)
    requireIntegerRange(budgets.maxTokens, 'budgets.maxTokens', 1, AGENT_TASK_LIMITS.maxTokens);
}

function validateSkillPolicy(value: unknown): CreateAgentTaskRequest['skillPolicy']['allow'] {
  const policy = requireObject(value, 'skillPolicy');
  assertAllowedKeys(policy, ['allow'], 'skillPolicy');
  if (!Array.isArray(policy.allow)) fail('skillPolicy.allow must be an array');
  if (policy.allow.length > AGENT_TASK_LIMITS.maxSkillsPerTask) {
    fail(`skillPolicy.allow supports at most ${AGENT_TASK_LIMITS.maxSkillsPerTask} Skill`);
  }
  const pins = policy.allow.map((rawPin, index) => {
    const pin = requireObject(rawPin, `skillPolicy.allow[${index}]`);
    assertAllowedKeys(pin, ['skillId', 'version', 'contentHash'], `skillPolicy.allow[${index}]`);
    const skillId = requireBoundedString(
      pin.skillId,
      `skillPolicy.allow[${index}].skillId`,
      1,
      128
    );
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(skillId))
      fail(`skillPolicy.allow[${index}].skillId is invalid`);
    const version = requireBoundedString(
      pin.version,
      `skillPolicy.allow[${index}].version`,
      1,
      100
    );
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      fail(`skillPolicy.allow[${index}].version must use semantic versioning`);
    }
    const contentHash = requireBoundedString(
      pin.contentHash,
      `skillPolicy.allow[${index}].contentHash`,
      64,
      64
    );
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      fail(`skillPolicy.allow[${index}].contentHash must be lowercase SHA-256`);
    }
    return { skillId, version, contentHash };
  });
  if (new Set(pins.map((pin) => pin.skillId)).size !== pins.length) {
    fail('skillPolicy.allow must not contain duplicate Skill ids');
  }
  return pins;
}

function validateCorrelation(value: unknown): void {
  if (value === undefined) return;
  const correlation = requireObject(value, 'correlation');
  if (Object.keys(correlation).length > 20) fail('correlation contains too many entries');
  for (const [key, entry] of Object.entries(correlation)) {
    requireBoundedString(key, 'correlation key', 1, 64);
    requireBoundedString(entry, `correlation.${key}`, 1, 256);
  }
}

function validateBrowserBinding(value: unknown): CreateAgentTaskRequest['browserBinding'] {
  if (value === undefined) return undefined;
  const binding = requireObject(value, 'browserBinding');
  assertAllowedKeys(
    binding,
    [
      'browserSessionId',
      'tabId',
      'browserLeaseId',
      'browserLeaseToken',
      'browserLeaseSequence',
      'access',
    ],
    'browserBinding'
  );
  const access = binding.access;
  if (access !== 'observe' && access !== 'control') fail('browserBinding.access is invalid');
  return {
    browserSessionId: requireBoundedString(
      binding.browserSessionId,
      'browserBinding.browserSessionId',
      1,
      128
    ),
    tabId: requireBoundedString(binding.tabId, 'browserBinding.tabId', 1, 128),
    browserLeaseId: requireBoundedString(
      binding.browserLeaseId,
      'browserBinding.browserLeaseId',
      1,
      128
    ),
    browserLeaseToken: requireBoundedString(
      binding.browserLeaseToken,
      'browserBinding.browserLeaseToken',
      1,
      4096
    ),
    browserLeaseSequence: requireIntegerRange(
      binding.browserLeaseSequence,
      'browserBinding.browserLeaseSequence',
      1,
      Number.MAX_SAFE_INTEGER
    ),
    access,
  };
}

function validateBrowserSteps(
  rawConstraints: unknown,
  allow: readonly string[],
  access: 'observe' | 'control' | undefined
): ReadonlyMap<string, AgentTaskBrowserStep> {
  const executeAllowed = allow.includes(CONTROLLED_EXECUTE_TOOL);
  if (!executeAllowed) {
    if (
      rawConstraints !== undefined &&
      Object.keys(requireObject(rawConstraints, 'toolPolicy.constraints')).length > 0
    ) {
      fail('Tool constraints are only implemented for browser-control.operation_execute');
    }
    return new Map();
  }
  if (!access) fail('browserBinding is required when operation_execute is allowed');
  const constraints = requireObject(rawConstraints, 'toolPolicy.constraints');
  assertAllowedKeys(constraints, [CONTROLLED_EXECUTE_TOOL], 'toolPolicy.constraints');
  const executeConstraints = requireObject(
    constraints[CONTROLLED_EXECUTE_TOOL],
    `${CONTROLLED_EXECUTE_TOOL} constraints`
  );
  assertAllowedKeys(executeConstraints, ['steps'], `${CONTROLLED_EXECUTE_TOOL} constraints`);
  if (
    !Array.isArray(executeConstraints.steps) ||
    executeConstraints.steps.length === 0 ||
    executeConstraints.steps.length > AGENT_TASK_LIMITS.maxBrowserSteps
  ) {
    fail(`Browser steps must contain between 1 and ${AGENT_TASK_LIMITS.maxBrowserSteps} entries`);
  }
  const result = new Map<string, AgentTaskBrowserStep>();
  for (const [index, rawStep] of executeConstraints.steps.entries()) {
    const step = requireObject(rawStep, `Browser step ${index}`) as unknown as AgentTaskBrowserStep;
    assertAllowedKeys(
      step as unknown as Record<string, unknown>,
      ['stepId', 'kind', 'operation', 'effectId', 'maxAffectedItems', 'capture'],
      `Browser step ${index}`
    );
    requireBoundedString(step.stepId, `Browser step ${index}.stepId`, 1, 128);
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
    if (step.effectId !== undefined)
      requireBoundedString(step.effectId, `Browser step ${step.stepId}.effectId`, 1, 128);
    if (step.maxAffectedItems !== undefined)
      requireIntegerRange(
        step.maxAffectedItems,
        `Browser step ${step.stepId}.maxAffectedItems`,
        1,
        1
      );
    if (step.capture !== undefined) validateCapture(step.capture, step.stepId);
    result.set(step.stepId, step);
  }
  return result;
}

function validateCapture(value: unknown, stepId: string): void {
  const capture = requireObject(value, `Browser step ${stepId}.capture`);
  assertAllowedKeys(
    capture,
    ['beforeScreenshot', 'afterScreenshot', 'domSnapshot', 'videoSegment'],
    `Browser step ${stepId}.capture`
  );
  if (Object.values(capture).some((entry) => typeof entry !== 'boolean'))
    fail(`Browser step ${stepId}.capture values must be boolean`);
  if (capture.videoSegment === true) fail('Browser operation video capture is not available');
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

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unknown fields`, { unknownFields: unknown });
}

function requireBoundedString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    fail(`${label} must be a string between ${min} and ${max} characters`);
  return value;
}

function requireIntegerRange(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(`${label} must be an integer between ${min} and ${max}`);
  return value as number;
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
