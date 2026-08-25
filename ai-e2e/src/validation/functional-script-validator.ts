import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

const SCRIPT_KEYS = /^[a-z][a-z0-9_.-]{2,63}$/;
const STEP_IDS = /^step_[a-z0-9_.-]{1,48}$/;
const ACTIONS = new Set([
  'observe',
  'navigate',
  'click',
  'fill',
  'type_text',
  'press',
  'select_option',
  'check',
  'uncheck',
  'focus',
  'blur',
  'hover',
  'scroll',
  'set_files',
  'switch_tab',
  'close_tab',
]);
const ASSERTIONS = new Set([
  'page.matches_anchor',
  'page.title',
  'page.url',
  'tab.count',
  'tab.active_matches',
  'element.exists',
  'element.not_exists',
  'element.visible',
  'element.hidden',
  'element.enabled',
  'element.disabled',
  'element.editable',
  'element.checked',
  'element.unchecked',
  'element.text',
  'element.value',
  'element.attribute',
  'element.count',
  'download.created',
  'screenshot.diff_ratio',
]);
const VALUE_TYPES = new Set([
  'string',
  'integer',
  'number',
  'boolean',
  'uuid',
  'date',
  'enum',
  'object',
  'array',
  'artifact_ref',
  'secret_ref',
]);
const TOP_LEVEL_FIELDS = new Set([
  'schema',
  'scriptKey',
  'name',
  'purpose',
  'moduleId',
  'pageScope',
  'inputs',
  'preconditions',
  'steps',
  'finalAssertions',
  'outputs',
  'sideEffects',
  'executionPolicy',
  'tags',
]);

export const FunctionalScriptV1Schema = Type.Object(
  {
    schema: Type.Literal('nebula.ai-e2e.functional-script/1.0'),
    scriptKey: Type.String({ pattern: SCRIPT_KEYS.source, minLength: 3, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    purpose: Type.String({ minLength: 1, maxLength: 1_000 }),
    moduleId: Type.String({ minLength: 1, maxLength: 200 }),
    pageScope: Type.Object(
      {
        entryPageId: Type.String({ minLength: 1, maxLength: 200 }),
        allowedTransitions: Type.Array(Type.Unknown(), { maxItems: 100 }),
        successPageId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
      },
      { additionalProperties: false }
    ),
    inputs: Type.Array(Type.Unknown(), { maxItems: 100 }),
    preconditions: Type.Array(Type.Unknown(), { maxItems: 100 }),
    steps: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 100 }),
    finalAssertions: Type.Array(Type.Unknown(), { minItems: 1, maxItems: 100 }),
    outputs: Type.Array(Type.Unknown(), { maxItems: 100 }),
    sideEffects: Type.Array(Type.Unknown(), { maxItems: 100 }),
    executionPolicy: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    tags: Type.Optional(Type.Array(Type.String({ maxLength: 16_384 }), { maxItems: 100 })),
  },
  { additionalProperties: false, $id: 'nebula.ai-e2e.functional-script/1.0' }
);

export class FunctionalScriptValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`功能脚本 Schema 校验失败: ${issues.join('; ')}`);
    this.name = 'FunctionalScriptValidationError';
  }
}

export function validateFunctionalScriptV1(payload: unknown): void {
  const issues: string[] = [];
  if (!isObject(payload)) {
    throw new FunctionalScriptValidationError(['$ 必须是对象']);
  }
  if (!Value.Check(FunctionalScriptV1Schema, payload)) {
    issues.push(
      ...Array.from(
        Value.Errors(FunctionalScriptV1Schema, payload),
        (error) => `${error.path || '$'} ${error.message}`
      )
    );
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 1024 * 1024) {
    issues.push('$ 超过 1 MiB');
  }
  rejectUnknown(payload, TOP_LEVEL_FIELDS, '$', issues);
  exact(payload.schema, 'nebula.ai-e2e.functional-script/1.0', '$.schema', issues);
  text(payload.scriptKey, '$.scriptKey', 1, 64, issues, SCRIPT_KEYS);
  text(payload.name, '$.name', 1, 120, issues);
  text(payload.purpose, '$.purpose', 1, 1_000, issues);
  text(payload.moduleId, '$.moduleId', 1, 200, issues);
  validatePageScope(payload.pageScope, issues);
  validateInputs(payload.inputs, issues);
  validateAssertions(payload.preconditions, '$.preconditions', issues);
  validateSteps(payload.steps, payload.sideEffects, issues);
  validateAssertions(payload.finalAssertions, '$.finalAssertions', issues, 1);
  validateOutputs(payload.outputs, payload.steps, payload.inputs, issues);
  validateSideEffects(payload.sideEffects, issues);
  if (payload.tags !== undefined) requireArray(payload.tags, '$.tags', 0, 100, issues);
  if (payload.executionPolicy !== undefined && !isObject(payload.executionPolicy)) {
    issues.push('$.executionPolicy 必须是对象');
  }
  if (issues.length > 0) throw new FunctionalScriptValidationError(issues);
}

function validatePageScope(value: unknown, issues: string[]): void {
  if (!isObject(value)) {
    issues.push('$.pageScope 必须是对象');
    return;
  }
  rejectUnknown(
    value,
    new Set(['entryPageId', 'allowedTransitions', 'successPageId']),
    '$.pageScope',
    issues
  );
  text(value.entryPageId, '$.pageScope.entryPageId', 1, 200, issues);
  const transitions = requireArray(
    value.allowedTransitions,
    '$.pageScope.allowedTransitions',
    0,
    100,
    issues
  );
  for (const [index, transition] of transitions.entries()) {
    if (!isObject(transition)) {
      issues.push(`$.pageScope.allowedTransitions[${index}] 必须是对象`);
      continue;
    }
    rejectUnknown(
      transition,
      new Set(['fromPageId', 'toPageId', 'reason', 'mayOpenNewTab']),
      `$.pageScope.allowedTransitions[${index}]`,
      issues
    );
    text(
      transition.fromPageId,
      `$.pageScope.allowedTransitions[${index}].fromPageId`,
      1,
      200,
      issues
    );
    text(transition.toPageId, `$.pageScope.allowedTransitions[${index}].toPageId`, 1, 200, issues);
    text(transition.reason, `$.pageScope.allowedTransitions[${index}].reason`, 1, 1_000, issues);
  }
}

function validateInputs(value: unknown, issues: string[]): void {
  const inputs = requireArray(value, '$.inputs', 0, 100, issues);
  const ids = new Set<string>();
  for (const [index, input] of inputs.entries()) {
    const path = `$.inputs[${index}]`;
    if (!isObject(input)) {
      issues.push(`${path} 必须是对象`);
      continue;
    }
    rejectUnknown(
      input,
      new Set([
        'id',
        'name',
        'type',
        'required',
        'sensitivity',
        'description',
        'constraints',
        'default',
      ]),
      path,
      issues
    );
    text(input.id, `${path}.id`, 1, 100, issues);
    text(input.name, `${path}.name`, 1, 120, issues);
    text(input.description, `${path}.description`, 1, 1_000, issues);
    if (!VALUE_TYPES.has(String(input.type))) issues.push(`${path}.type 无效`);
    if (typeof input.required !== 'boolean') issues.push(`${path}.required 必须是布尔值`);
    if (!['public', 'sensitive', 'secret'].includes(String(input.sensitivity)))
      issues.push(`${path}.sensitivity 无效`);
    if (
      input.sensitivity === 'secret' &&
      (input.type !== 'secret_ref' || input.default !== undefined)
    )
      issues.push(`${path} secret 输入必须是无默认值的 secret_ref`);
    if (['object', 'array'].includes(String(input.type)) && !isObject(input.constraints))
      issues.push(`${path}.constraints 必填`);
    if (typeof input.id === 'string') {
      if (ids.has(input.id)) issues.push(`${path}.id 必须唯一`);
      ids.add(input.id);
    }
  }
}

function validateSteps(value: unknown, sideEffects: unknown, issues: string[]): void {
  const steps = requireArray(value, '$.steps', 1, 100, issues);
  const effectIds = new Set(
    Array.isArray(sideEffects)
      ? sideEffects
          .filter(isObject)
          .map((effect) => effect.id)
          .filter((id): id is string => typeof id === 'string')
      : []
  );
  const ids = new Set<string>();
  for (const [index, raw] of steps.entries()) {
    const path = `$.steps[${index}]`;
    if (!isObject(raw)) {
      issues.push(`${path} 必须是对象`);
      continue;
    }
    rejectUnknown(
      raw,
      new Set([
        'id',
        'name',
        'intent',
        'preconditions',
        'action',
        'postconditions',
        'captures',
        'checkpoint',
        'sideEffectId',
        'timeoutMs',
      ]),
      path,
      issues
    );
    text(raw.id, `${path}.id`, 1, 54, issues, STEP_IDS);
    if (typeof raw.id === 'string') {
      if (ids.has(raw.id)) issues.push(`${path}.id 必须唯一`);
      ids.add(raw.id);
    }
    text(raw.name, `${path}.name`, 1, 120, issues);
    text(raw.intent, `${path}.intent`, 1, 1_000, issues);
    if (raw.preconditions !== undefined)
      validateAssertions(raw.preconditions, `${path}.preconditions`, issues);
    validateAction(raw.action, `${path}.action`, issues);
    validateAssertions(raw.postconditions, `${path}.postconditions`, issues);
    if (typeof raw.sideEffectId === 'string' && !effectIds.has(raw.sideEffectId)) {
      issues.push(`${path}.sideEffectId 未引用已声明副作用`);
    }
  }
}

function validateAction(value: unknown, path: string, issues: string[]): void {
  if (!isObject(value) || typeof value.type !== 'string') {
    issues.push(`${path}.type 必填`);
    return;
  }
  if (!ACTIONS.has(value.type)) issues.push(`${path}.type 不在白名单`);
  if (
    [
      'click',
      'fill',
      'type_text',
      'select_option',
      'check',
      'uncheck',
      'focus',
      'blur',
      'hover',
      'set_files',
    ].includes(value.type)
  ) {
    if (!isObject(value.target)) issues.push(`${path}.target 必填`);
  }
  if (value.type === 'navigate' && !isObject(value.pageAnchor)) {
    issues.push(`${path}.pageAnchor 必填`);
  }
  if (value.target !== undefined) validateTarget(value.target, `${path}.target`, issues);
}

function validateAssertions(value: unknown, path: string, issues: string[], min = 0): void {
  const assertions = requireArray(value, path, min, 100, issues);
  const ids = new Set<string>();
  for (const [index, assertion] of assertions.entries()) {
    if (!isObject(assertion)) {
      issues.push(`${path}[${index}] 必须是对象`);
      continue;
    }
    text(assertion.id, `${path}[${index}].id`, 1, 100, issues);
    text(assertion.kind, `${path}[${index}].kind`, 1, 100, issues);
    text(assertion.message, `${path}[${index}].message`, 1, 1_000, issues);
    if (!ASSERTIONS.has(String(assertion.kind))) issues.push(`${path}[${index}].kind 不在白名单`);
    if (assertion.target !== undefined)
      validateTarget(assertion.target, `${path}[${index}].target`, issues);
    if (assertion.kind === 'element.attribute' && typeof assertion.attribute !== 'string')
      issues.push(`${path}[${index}].attribute 必填`);
    if (
      assertion.kind === 'screenshot.diff_ratio' &&
      typeof assertion.baselineVariantId !== 'string'
    )
      issues.push(`${path}[${index}].baselineVariantId 必填`);
    if (typeof assertion.id === 'string') {
      if (ids.has(assertion.id)) issues.push(`${path}[${index}].id 必须唯一`);
      ids.add(assertion.id);
    }
  }
}

function validateTarget(value: unknown, path: string, issues: string[]): void {
  if (!isObject(value)) {
    issues.push(`${path} 必须是对象`);
    return;
  }
  rejectUnknown(
    value,
    new Set(['semantic', 'candidates', 'expected', 'baselineHint']),
    path,
    issues
  );
  text(value.semantic, `${path}.semantic`, 1, 1_000, issues);
  const candidates = requireArray(value.candidates, `${path}.candidates`, 1, 20, issues);
  if (
    !candidates.some(
      (candidate) =>
        isObject(candidate) &&
        ['role', 'test_id', 'label', 'placeholder', 'text'].includes(String(candidate.strategy))
    )
  ) {
    issues.push(`${path}.candidates 至少包含一个语义候选`);
  }
  if (
    !isObject(value.expected) ||
    !['exactly_one', 'at_least_one', 'zero_or_one'].includes(String(value.expected.cardinality))
  )
    issues.push(`${path}.expected.cardinality 无效`);
}

function validateOutputs(
  value: unknown,
  stepsValue: unknown,
  inputsValue: unknown,
  issues: string[]
): void {
  const outputs = requireArray(value, '$.outputs', 0, 100, issues);
  const inputIds = new Set(
    Array.isArray(inputsValue)
      ? inputsValue
          .filter(isObject)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === 'string')
      : []
  );
  const stepIds = new Set(
    Array.isArray(stepsValue)
      ? stepsValue
          .filter(isObject)
          .map((item) => item.id)
          .filter((id): id is string => typeof id === 'string')
      : []
  );
  for (const [index, output] of outputs.entries()) {
    const path = `$.outputs[${index}]`;
    if (!isObject(output)) {
      issues.push(`${path} 必须是对象`);
      continue;
    }
    text(output.id, `${path}.id`, 1, 100, issues);
    text(output.name, `${path}.name`, 1, 120, issues);
    text(output.description, `${path}.description`, 1, 1_000, issues);
    if (!VALUE_TYPES.has(String(output.type))) issues.push(`${path}.type 无效`);
    if (!['public', 'sensitive', 'secret'].includes(String(output.sensitivity)))
      issues.push(`${path}.sensitivity 无效`);
    if (!isObject(output.from) || (!('inputId' in output.from) && !('stepId' in output.from)))
      issues.push(`${path}.from 无效`);
    if (
      isObject(output.from) &&
      typeof output.from.inputId === 'string' &&
      !inputIds.has(output.from.inputId)
    )
      issues.push(`${path}.from.inputId 未声明`);
    if (
      isObject(output.from) &&
      typeof output.from.stepId === 'string' &&
      !stepIds.has(output.from.stepId)
    )
      issues.push(`${path}.from.stepId 未声明`);
  }
}

function validateSideEffects(value: unknown, issues: string[]): void {
  const effects = requireArray(value, '$.sideEffects', 0, 100, issues);
  const ids = new Set<string>();
  for (const [index, effect] of effects.entries()) {
    const path = `$.sideEffects[${index}]`;
    if (!isObject(effect)) {
      issues.push(`${path} 必须是对象`);
      continue;
    }
    text(effect.id, `${path}.id`, 1, 100, issues);
    text(effect.resourceType, `${path}.resourceType`, 1, 200, issues);
    if (!['create', 'update', 'delete', 'auth_change'].includes(String(effect.kind)))
      issues.push(`${path}.kind 无效`);
    if (!isObject(effect.identityFrom)) issues.push(`${path}.identityFrom 必填`);
    if (!isObject(effect.affectedItems)) issues.push(`${path}.affectedItems 必填`);
    if (!['reversible', 'compensatable', 'irreversible'].includes(String(effect.reversibility)))
      issues.push(`${path}.reversibility 无效`);
    validateAssertions(effect.verifyApplied, `${path}.verifyApplied`, issues, 1);
    if (!['verify_before_retry', 'never_retry'].includes(String(effect.retryPolicy)))
      issues.push(`${path}.retryPolicy 无效`);
    if (typeof effect.id === 'string') {
      if (ids.has(effect.id)) issues.push(`${path}.id 必须唯一`);
      ids.add(effect.id);
    }
  }
}

function requireArray(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: string[]
): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须是数组`);
    return [];
  }
  if (value.length < min || value.length > max) issues.push(`${path} 数量必须为 ${min}–${max}`);
  return value;
}

function text(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: string[],
  pattern?: RegExp
): void {
  if (typeof value !== 'string' || value.length < min || value.length > max) {
    issues.push(`${path} 必须是长度 ${min}–${max} 的字符串`);
  } else if (pattern && !pattern.test(value)) {
    issues.push(`${path} 格式无效`);
  }
}

function exact(value: unknown, expected: string, path: string, issues: string[]): void {
  if (value !== expected) issues.push(`${path} 必须是 ${expected}`);
}

function rejectUnknown(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  path: string,
  issues: string[]
): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) issues.push(`${path}.${key} 是未知字段`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
