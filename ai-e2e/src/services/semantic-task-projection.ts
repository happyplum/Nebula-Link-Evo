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

export function buildRunTaskProjection(todo: CoordinatorTodo, pageTaskId: string): RunTaskProjection {
  const steps = buildSemanticBrowserSteps(todo.script);
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
      completion:
        '只有所有硬断言通过才返回 succeeded；未知副作用结果必须返回 outcome_unknown。',
    },
  };
  const toolPolicy = {
    allow: ['browser-control.operation_execute'],
    constraints: {
      'browser-control.operation_execute': { steps },
    },
  };
  const agentRequest: Omit<CreateAgentTaskInput, 'browserBinding'> = {
    schema: 'nebula.ai.agent-task/1.0',
    clientTaskId: pageTaskId,
    modelRole: 'decision',
    input: taskInput,
    responseSchema: semanticExecutionResultSchema(),
    toolPolicy,
    skillPolicy: { allow: [] },
    budgets: budget,
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

export function buildSemanticBrowserSteps(script: Record<string, unknown>): AgentTaskBrowserStep[] {
  const semanticSteps = Array.isArray(script.steps) ? script.steps : [];
  const result: AgentTaskBrowserStep[] = [];
  for (const [index, raw] of semanticSteps.entries()) {
    if (!isObject(raw)) throw new Error(`语义脚本第 ${index + 1} 步不是对象`);
    addAssertions(result, raw.preconditions, `step-${index + 1}-pre`);
    const action = normalizeAction(raw.action);
    const stepId = stringValue(raw.id) ?? `step-${index + 1}`;
    result.push({
      stepId,
      kind: action.kind,
      operation: action.operation,
      ...(stringValue(raw.sideEffectId) ? { effectId: String(raw.sideEffectId) } : {}),
      ...(stringValue(raw.sideEffectId) ? { maxAffectedItems: requireSingleEffect(script, raw) } : {}),
      capture: action.kind === 'act'
        ? { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true }
        : { domSnapshot: true },
    });
    addAssertions(result, raw.postconditions, `${stepId}-post`);
  }
  addAssertions(result, script.preconditions, 'script-pre');
  addAssertions(result, script.finalAssertions, 'script-final');
  if (result.length === 0) {
    result.push({ stepId: 'script-observe', kind: 'observe', operation: 'page_state', capture: { domSnapshot: true } });
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

function normalizeAction(value: unknown): { kind: 'observe' | 'act'; operation: string } {
  const type = typeof value === 'string' ? value : isObject(value) ? value.type : undefined;
  if (type === 'observe') return { kind: 'observe', operation: 'page_state' };
  if (typeof type !== 'string') throw new Error('语义步骤缺少 action.type');
  if (ACT_OPERATIONS.has(type)) return { kind: 'act', operation: type };
  if (OBSERVE_OPERATIONS.has(type)) return { kind: 'observe', operation: type };
  if (type === 'set_files') throw new Error('当前 proxy-adapter 尚未声明 set_files 动作能力');
  throw new Error(`不支持的浏览器动作 '${type}'`);
}

function addAssertions(target: AgentTaskBrowserStep[], value: unknown, prefix: string): void {
  if (!Array.isArray(value)) return;
  for (const [index, raw] of value.entries()) {
    if (!isObject(raw)) continue;
    target.push({
      stepId: stringValue(raw.id) ?? `${prefix}-${index + 1}`,
      kind: 'observe',
      operation: assertionOperation(stringValue(raw.kind)),
      capture: { domSnapshot: true },
    });
  }
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
    Object.entries(deployment).filter(([key]) => !/(credential|password|token|secret|cookie)/i.test(key))
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
