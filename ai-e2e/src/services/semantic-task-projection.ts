import type {
  AgentTaskBrowserStep,
  CreateAgentTaskInput,
} from '../infrastructure/agent-task-client.js';
import type { CoordinatorTodo } from '../database/repositories/semantic-coordinator-repository.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';

const ACT_OPERATIONS = new Set([
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
  'switch_tab',
  'close_tab',
]);

const OBSERVE_OPERATIONS = new Set([
  'page_state',
  'target_state',
  'url',
  'title',
  'text',
  'value',
  'attribute',
  'count',
  'tabs',
]);

export interface RunTaskProjection {
  agentRequest: Omit<CreateAgentTaskInput, 'browserBinding'>;
  steps: AgentTaskBrowserStep[];
  operations: string[];
  taskPayloadSha256: string;
  toolPolicyHash: string;
  budget: CreateAgentTaskInput['budgets'];
}

export function buildRunTaskProjection(
  todo: CoordinatorTodo,
  pageTaskId: string
): RunTaskProjection {
  const steps = buildSemanticBrowserSteps(todo.script, todo.input, todo.deployment, todo.page);
  const operations = [...new Set(steps.map((step) => step.operation))];
  const budget = {
    maxDurationMs: 5 * 60 * 1_000,
    maxModelTurns: 12,
    maxToolCalls: Math.min(50, Math.max(steps.length * 2, 8)),
    maxTokens: 24_000,
  };
  const taskInput = {
    schema: 'nebula.ai-e2e.page-task-input/1.0',
    objective:
      '严格按冻结语义脚本执行。只调用预授权 stepId；确定性断言失败不得改写脚本或弱化预期。',
    runId: todo.runId,
    todoId: todo.todoId,
    pageTaskId,
    scriptRevisionId: todo.scriptRevisionId,
    pageRevisionId: todo.pageRevisionId,
    inputs: todo.input,
    inputSecretRefs: todo.inputSecretRefs,
    authContext: todo.authContext,
    script: todo.script,
    page: todo.page,
    deployment: redactDeployment(todo.deployment),
    authorizedSteps: steps,
    outputContract: {
      jsonFields:
        'actualPageJson/confirmedOutputsJson/partialOutputsJson/sideEffectsJson/downstreamImpactJson/checkpointJson 必须是 JSON object 字符串',
      completion: '只有所有硬断言通过才返回 succeeded；未知副作用结果必须返回 outcome_unknown。',
    },
  };
  const toolPolicy = {
    allow: ['browser-control.operation_execute'],
    constraints: {
      'browser-control.operation_execute': { steps },
    },
  };
  const sideEffectAuthorization = buildSideEffectAuthorization(todo, steps);
  const agentRequest: Omit<CreateAgentTaskInput, 'browserBinding'> = {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: pageTaskId,
    modelRole: 'decision',
    input: taskInput,
    responseSchema: semanticExecutionResultSchema(),
    toolPolicy,
    skillPolicy: { allow: [] },
    budgets: budget,
    ...(sideEffectAuthorization ? { sideEffectAuthorization } : {}),
    correlation: {
      runId: todo.runId,
      todoId: todo.todoId,
      pageTaskId,
      scriptRevisionId: todo.scriptRevisionId,
    },
  };
  return {
    agentRequest,
    steps,
    operations,
    taskPayloadSha256: hashValue(taskInput),
    toolPolicyHash: hashValue(toolPolicy),
    budget,
  };
}

function buildSideEffectAuthorization(
  todo: CoordinatorTodo,
  steps: AgentTaskBrowserStep[]
): NonNullable<CreateAgentTaskInput['sideEffectAuthorization']> | undefined {
  const effectSteps = steps.filter((step) => step.effectId);
  if (effectSteps.length === 0) return undefined;
  if (
    !todo.policyEvaluationId ||
    !todo.policyVersion ||
    !todo.policyResult ||
    todo.policyResult === 'denied' ||
    !todo.policyProjectionSha256
  ) {
    throw new Error('副作用步骤缺少冻结 policy evaluation');
  }
  const declarations = Array.isArray(todo.script.sideEffects) ? todo.script.sideEffects : [];
  const effects = effectSteps.map((step) => {
    const declaration = declarations.find((entry) => isObject(entry) && entry.id === step.effectId);
    if (!isObject(declaration)) throw new Error(`副作用 '${step.effectId}' 缺少冻结声明`);
    const kind = String(declaration.kind);
    const reversibility = String(declaration.reversibility);
    if (!['create', 'update', 'delete', 'auth_change'].includes(kind)) {
      throw new Error(`副作用 '${step.effectId}' kind 无效`);
    }
    if (!['reversible', 'compensatable', 'irreversible'].includes(reversibility)) {
      throw new Error(`副作用 '${step.effectId}' reversibility 无效`);
    }
    return {
      stepId: step.stepId,
      effectId: String(step.effectId),
      kind: kind as 'create' | 'update' | 'delete' | 'auth_change',
      maxAffectedItems: step.maxAffectedItems ?? 1,
      reversibility: reversibility as 'reversible' | 'compensatable' | 'irreversible',
    };
  });
  const environment = String(todo.deployment.environment);
  if (!['local', 'test', 'staging', 'production'].includes(environment)) {
    throw new Error(`冻结 deployment environment '${environment}' 无效`);
  }
  return {
    contextType: 'run',
    contextId: todo.runId,
    environment: environment as 'local' | 'test' | 'staging' | 'production',
    policyVersion: todo.policyVersion,
    policyEvaluationId: todo.policyEvaluationId,
    policyResult: todo.policyResult,
    projectionSha256: todo.policyProjectionSha256,
    effects,
    ...(todo.approvalGrantId &&
    todo.approvalGrantStatus === 'active' &&
    todo.approvedProjectionSha256
      ? {
          grant: {
            grantId: todo.approvalGrantId,
            status: 'active' as const,
            approvedProjectionSha256: todo.approvedProjectionSha256,
          },
        }
      : {}),
  };
}

export function buildSemanticBrowserSteps(
  script: Record<string, unknown>,
  inputs: Record<string, unknown> = {},
  deployment: Record<string, unknown> = {},
  page: Record<string, unknown> = {}
): AgentTaskBrowserStep[] {
  const semanticSteps = Array.isArray(script.steps) ? script.steps : [];
  const result: AgentTaskBrowserStep[] = [];
  for (const [index, raw] of semanticSteps.entries()) {
    if (!isObject(raw)) throw new Error(`语义脚本第 ${index + 1} 步不是对象`);
    addAssertions(result, raw.preconditions, `step-${index + 1}-pre`, inputs);
    const action = normalizeAction(raw.action, inputs, deployment, page);
    const stepId = stringValue(raw.id) ?? `step-${index + 1}`;
    result.push({
      stepId,
      kind: action.kind,
      operation: action.operation,
      ...(action.target ? { target: action.target } : {}),
      ...(action.args ? { args: action.args } : {}),
      ...(stringValue(raw.sideEffectId) ? { effectId: String(raw.sideEffectId) } : {}),
      ...(stringValue(raw.sideEffectId)
        ? { maxAffectedItems: requireSingleEffect(script, raw) }
        : {}),
      capture:
        action.kind === 'act'
          ? { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true }
          : { domSnapshot: true },
    });
    addAssertions(result, raw.postconditions, `${stepId}-post`, inputs);
  }
  addAssertions(result, script.preconditions, 'script-pre', inputs);
  addAssertions(result, script.finalAssertions, 'script-final', inputs);
  if (result.length === 0) {
    result.push({
      stepId: 'script-observe',
      kind: 'observe',
      operation: 'page_state',
      capture: { domSnapshot: true },
    });
  }
  if (result.length > 100) throw new Error('语义脚本展开后超过 Agent task 的 100 步上限');
  const seen = new Set<string>();
  return result.map((step, index) => {
    const base = step.stepId.slice(0, 110) || `step-${index + 1}`;
    let candidate = base;
    let suffix = 1;
    while (seen.has(candidate)) candidate = `${base.slice(0, 104)}-${suffix++}`;
    seen.add(candidate);
    return { ...step, stepId: candidate };
  });
}

function normalizeAction(
  value: unknown,
  inputs: Record<string, unknown>,
  deployment: Record<string, unknown>,
  page: Record<string, unknown>
): {
  kind: 'observe' | 'act';
  operation: string;
  target?: AgentTaskBrowserStep['target'];
  args?: Record<string, unknown>;
} {
  const type = typeof value === 'string' ? value : isObject(value) ? value.type : undefined;
  if (type === 'observe') return { kind: 'observe', operation: 'page_state' };
  if (typeof type !== 'string') throw new Error('语义步骤缺少 action.type');
  if (ACT_OPERATIONS.has(type)) {
    const action = value as Record<string, unknown>;
    const target = action.target === undefined ? undefined : normalizeTarget(action.target, inputs);
    const args = normalizeActionArgs(type, action, inputs, deployment, page);
    return {
      kind: 'act',
      operation: type,
      ...(target ? { target } : {}),
      ...(args ? { args } : {}),
    };
  }
  if (OBSERVE_OPERATIONS.has(type)) return { kind: 'observe', operation: type };
  if (type === 'set_files') throw new Error('当前 proxy-adapter 尚未声明 set_files 动作能力');
  throw new Error(`不支持的浏览器动作 '${type}'`);
}

function addAssertions(
  target: AgentTaskBrowserStep[],
  value: unknown,
  prefix: string,
  inputs: Record<string, unknown>
): void {
  if (!Array.isArray(value)) return;
  for (const [index, raw] of value.entries()) {
    if (!isObject(raw)) continue;
    const operation = assertionOperation(stringValue(raw.kind));
    target.push({
      stepId: stringValue(raw.id) ?? `${prefix}-${index + 1}`,
      kind: 'observe',
      operation,
      ...(raw.target !== undefined ? { target: normalizeTarget(raw.target, inputs) } : {}),
      ...(operation === 'attribute' && stringValue(raw.attribute)
        ? { args: { name: String(raw.attribute) } }
        : {}),
      capture: { domSnapshot: true },
    });
  }
}

function normalizeActionArgs(
  operation: string,
  action: Record<string, unknown>,
  inputs: Record<string, unknown>,
  deployment: Record<string, unknown>,
  page: Record<string, unknown>
): Record<string, unknown> | undefined {
  switch (operation) {
    case 'navigate':
      return {
        url: resolvePageUrl(action.pageAnchor, inputs, deployment, page),
        waitUntil: action.waitFor,
      };
    case 'click':
      return compact({ button: action.button, clickCount: action.clickCount });
    case 'fill':
      return { value: String(resolveValue(action.value, inputs)) };
    case 'type_text':
      return {
        value: String(resolveValue(action.value, inputs)),
        ...(action.delayMs !== undefined ? { delayMs: action.delayMs } : {}),
      };
    case 'press':
      return { key: action.key };
    case 'select_option':
      return {
        values: requireArray(action.values, 'select_option.values').map((entry) =>
          String(resolveValue(entry, inputs))
        ),
      };
    case 'scroll':
      return { direction: action.direction, amount: action.amount };
    case 'switch_tab':
    case 'close_tab':
      throw new Error(`动作 '${operation}' 的语义 TabMatch 尚不能确定性投影为稳定 tabId`);
    default:
      return undefined;
  }
}

function normalizeTarget(
  value: unknown,
  inputs: Record<string, unknown>
): NonNullable<AgentTaskBrowserStep['target']> {
  if (
    !isObject(value) ||
    typeof value.semantic !== 'string' ||
    !Array.isArray(value.candidates) ||
    !isObject(value.expected)
  ) {
    throw new Error('语义目标缺少 semantic/candidates/expected');
  }
  return {
    semantic: value.semantic,
    candidates: value.candidates.map((candidate) => {
      if (!isObject(candidate) || typeof candidate.strategy !== 'string')
        throw new Error('语义目标候选无效');
      const resolved = { ...candidate };
      if ('name' in resolved) resolved.name = String(resolveValue(resolved.name, inputs));
      if ('value' in resolved) resolved.value = String(resolveValue(resolved.value, inputs));
      return resolved as NonNullable<AgentTaskBrowserStep['target']>['candidates'][number];
    }),
    expected: value.expected as NonNullable<AgentTaskBrowserStep['target']>['expected'],
  };
}

function resolveValue(value: unknown, inputs: Record<string, unknown>): unknown {
  if (!isObject(value) || typeof value.kind !== 'string') return value;
  if (value.kind === 'literal') return value.value;
  if (value.kind === 'input') {
    const inputId = stringValue(value.inputId);
    const runInputs = isObject(inputs.runInputs) ? inputs.runInputs : {};
    if (!inputId || (!(inputId in inputs) && !(inputId in runInputs)))
      throw new Error(`输入 '${inputId ?? ''}' 未冻结`);
    return inputId in inputs ? inputs[inputId] : runInputs[inputId];
  }
  if (value.kind === 'concat')
    return requireArray(value.values, 'concat.values')
      .map((entry) => String(resolveValue(entry, inputs)))
      .join('');
  throw new Error(`值表达式 '${value.kind}' 无法在派发前确定性解析`);
}

function resolvePageUrl(
  value: unknown,
  inputs: Record<string, unknown>,
  deployment: Record<string, unknown>,
  page: Record<string, unknown>
): string {
  if (!isObject(value) || typeof value.pageId !== 'string')
    throw new Error('navigate.pageAnchor 无效');
  const currentPageId = stringValue(page.id) ?? stringValue(page.pageId);
  if (currentPageId && currentPageId !== value.pageId)
    throw new Error(`页面锚点 '${value.pageId}' 不在当前冻结页面任务内`);
  const origin = stringValue(deployment.origin);
  let route = stringValue(page.routeTemplate);
  if (!origin || !route) throw new Error('冻结 deployment/page 缺少 origin 或 routeTemplate');
  const params = isObject(value.params) ? value.params : {};
  for (const [key, expression] of Object.entries(params)) {
    const encoded = encodeURIComponent(String(resolveValue(expression, inputs)));
    route = route.replaceAll(`{${key}}`, encoded).replaceAll(`:${key}`, encoded);
  }
  return new URL(route, origin).toString();
}

function compact(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const result = Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  return value;
}

function assertionOperation(kind?: string): string {
  if (!kind) return 'page_state';
  if (kind === 'page.title') return 'title';
  if (kind === 'page.url' || kind === 'page.matches_anchor') return 'url';
  if (kind.startsWith('tab.')) return 'tabs';
  if (kind === 'element.text') return 'text';
  if (kind === 'element.value') return 'value';
  if (kind === 'element.attribute') return 'attribute';
  if (kind === 'element.count') return 'count';
  if (kind.startsWith('element.')) return 'target_state';
  return 'page_state';
}

function requireSingleEffect(script: Record<string, unknown>, step: Record<string, unknown>): 1 {
  const effectId = String(step.sideEffectId);
  const effects = Array.isArray(script.sideEffects) ? script.sideEffects : [];
  const effect = effects.find((entry) => isObject(entry) && entry.id === effectId);
  if (!isObject(effect) || !isObject(effect.affectedItems)) {
    throw new Error(`副作用 '${effectId}' 缺少有界 affectedItems 声明`);
  }
  if (effect.affectedItems.kind !== 'single') {
    throw new Error(`副作用 '${effectId}' 超出当前 Agent task 单项写入授权边界`);
  }
  return 1;
}

function redactDeployment(deployment: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(deployment).filter(
      ([key]) => !/(credential|password|token|secret|cookie)/i.test(key)
    )
  );
}

export function semanticExecutionResultSchema(): Record<string, unknown> {
  const jsonString = { type: 'string', maxLength: 100_000 };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      result: {
        type: 'string',
        enum: [
          'succeeded',
          'assertion_failed',
          'execution_failed',
          'precondition_blocked',
          'decision_required',
          'outcome_unknown',
        ],
      },
      reasonClass: { type: 'string', minLength: 1, maxLength: 200 },
      summary: { type: 'string', minLength: 1, maxLength: 4_000 },
      actualPageJson: jsonString,
      confirmedOutputsJson: jsonString,
      partialOutputsJson: jsonString,
      sideEffectsJson: jsonString,
      downstreamImpactJson: jsonString,
      checkpointJson: jsonString,
    },
    required: ['result', 'reasonClass', 'summary'],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}
