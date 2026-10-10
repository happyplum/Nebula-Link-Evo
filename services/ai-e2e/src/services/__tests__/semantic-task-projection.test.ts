import { describe, expect, it } from 'vitest';
import type { CoordinatorTodo } from '../../database/repositories/semantic-coordinator-repository.js';
import {
  buildRunTaskProjection,
  buildSemanticBrowserSteps,
  semanticExecutionResultSchema,
} from '../semantic-task-projection.js';

const HASH_A = 'a'.repeat(64);

describe('semantic task projection', () => {
  it('builds the bounded default observation and redacts deployment secrets', () => {
    const projection = buildRunTaskProjection(baseTodo(), 'page-task-1');

    expect(projection.steps).toEqual([
      {
        stepId: 'script-observe',
        kind: 'observe',
        operation: 'page_state',
        capture: { domSnapshot: true },
      },
    ]);
    expect(projection.operations).toEqual(['page_state']);
    expect(projection.budget).toEqual({
      maxDurationMs: 300_000,
      maxModelTurns: 12,
      maxToolCalls: 8,
      maxTokens: 24_000,
    });
    expect(projection.agentRequest.sideEffectAuthorization).toBeUndefined();
    expect(projection.agentRequest.input.deployment).toEqual({
      environment: 'test',
      origin: 'https://example.test',
    });
    expect(projection.taskPayloadSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(projection.toolPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(semanticExecutionResultSchema()).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['result', 'reasonClass', 'summary'],
    });
  });

  it('projects actions, assertions, targets and frozen values deterministically', () => {
    const target = semanticTarget({
      kind: 'concat',
      values: ['save-', { kind: 'input', inputId: 'id' }],
    });
    const script = {
      preconditions: [
        { id: 'same', kind: 'page.title' },
        { id: 'url-check', kind: 'page.matches_anchor' },
        { kind: 'tab.count' },
      ],
      steps: [
        {
          id: 'same',
          action: {
            type: 'navigate',
            pageAnchor: { pageId: 'page-1', params: { id: { kind: 'input', inputId: 'id' } } },
            waitFor: 'domcontentloaded',
          },
          preconditions: [
            { kind: 'element.text', target },
            { kind: 'element.value', target },
            { kind: 'element.attribute', attribute: 'aria-label', target },
            { kind: 'element.count', target },
            { kind: 'element.visible', target },
            { kind: 'unknown' },
          ],
          postconditions: [{ id: 'post', kind: 'page.url' }],
        },
        { action: { type: 'click', target, button: 'left', clickCount: 2 } },
        { action: { type: 'fill', target, value: { kind: 'literal', value: 42 } } },
        {
          action: {
            type: 'type_text',
            target,
            value: { kind: 'input', inputId: 'fromNestedInputs' },
            delayMs: 5,
          },
        },
        { action: { type: 'press', target, key: 'Enter' } },
        {
          action: {
            type: 'select_option',
            target,
            values: [{ kind: 'input', inputId: 'id' }, 'fixed'],
          },
        },
        { action: { type: 'scroll', direction: 'down', amount: 300 } },
        { action: { type: 'check', target } },
        { action: 'observe' },
        { action: { type: 'title' } },
      ],
      finalAssertions: [{ kind: 'page.url' }],
    };

    const steps = buildSemanticBrowserSteps(
      script,
      { id: 'a b', runInputs: { fromNestedInputs: 'nested' } },
      { origin: 'https://example.test' },
      { id: 'page-1', routeTemplate: '/users/{id}' }
    );

    expect(steps.map((step) => step.operation)).toEqual(
      expect.arrayContaining([
        'navigate',
        'click',
        'fill',
        'type_text',
        'press',
        'select_option',
        'scroll',
        'check',
        'page_state',
        'title',
        'url',
        'tabs',
        'text',
        'value',
        'attribute',
        'count',
        'target_state',
      ])
    );
    expect(steps.find((step) => step.operation === 'navigate')?.args).toEqual({
      url: 'https://example.test/users/a%20b',
      waitUntil: 'domcontentloaded',
    });
    expect(steps.find((step) => step.operation === 'fill')?.args).toEqual({ value: '42' });
    expect(steps.find((step) => step.operation === 'type_text')?.args).toEqual({
      value: 'nested',
      delayMs: 5,
    });
    expect(steps.find((step) => step.operation === 'select_option')?.args).toEqual({
      values: ['a b', 'fixed'],
    });
    expect(steps.find((step) => step.operation === 'attribute')?.args).toEqual({
      name: 'aria-label',
    });
    expect(new Set(steps.map((step) => step.stepId)).size).toBe(steps.length);
    expect(steps.find((step) => step.operation === 'click')?.capture).toEqual({
      beforeScreenshot: true,
      afterScreenshot: true,
      domSnapshot: true,
    });
  });

  it('projects exact side-effect policy and an active grant', () => {
    const todo = baseTodo({
      policyEvaluationId: 'evaluation-1',
      policyVersion: 'policy-v1',
      policyResult: 'approval_required',
      policyProjectionSha256: HASH_A,
      approvalGrantId: 'grant-1',
      approvalGrantStatus: 'active',
      approvedProjectionSha256: HASH_A,
      deployment: { environment: 'staging', origin: 'https://example.test' },
      script: {
        sideEffects: [
          {
            id: 'effect-1',
            kind: 'update',
            reversibility: 'compensatable',
            affectedItems: { kind: 'single' },
          },
        ],
        steps: [
          {
            id: 'write-1',
            sideEffectId: 'effect-1',
            action: { type: 'fill', target: semanticTarget('field'), value: 'new' },
          },
        ],
      },
    });

    expect(
      buildRunTaskProjection(todo, 'page-task-2').agentRequest.sideEffectAuthorization
    ).toEqual({
      contextType: 'run',
      contextId: 'run-1',
      environment: 'staging',
      policyVersion: 'policy-v1',
      policyEvaluationId: 'evaluation-1',
      policyResult: 'approval_required',
      projectionSha256: HASH_A,
      effects: [
        {
          stepId: 'write-1',
          effectId: 'effect-1',
          kind: 'update',
          maxAffectedItems: 1,
          reversibility: 'compensatable',
        },
      ],
      grant: {
        grantId: 'grant-1',
        status: 'active',
        approvedProjectionSha256: HASH_A,
      },
    });
  });

  it.each([
    ['non-object step', { steps: ['invalid'] }, '不是对象'],
    ['missing action type', { steps: [{ action: {} }] }, '缺少 action.type'],
    ['unsupported action', { steps: [{ action: { type: 'download' } }] }, '不支持的浏览器动作'],
    ['unsupported files', { steps: [{ action: { type: 'set_files' } }] }, '尚未声明 set_files'],
    ['unstable tab', { steps: [{ action: { type: 'switch_tab' } }] }, '尚不能确定性投影'],
    [
      'invalid target',
      { steps: [{ action: { type: 'click', target: { semantic: 'x' } } }] },
      '语义目标缺少',
    ],
    [
      'invalid target candidate',
      {
        steps: [
          {
            action: {
              type: 'click',
              target: { semantic: 'x', candidates: [{}], expected: {} },
            },
          },
        ],
      },
      '目标候选无效',
    ],
    [
      'missing frozen input',
      {
        steps: [
          {
            action: {
              type: 'fill',
              target: semanticTarget('field'),
              value: { kind: 'input', inputId: 'missing' },
            },
          },
        ],
      },
      '未冻结',
    ],
    [
      'unknown value expression',
      {
        steps: [
          {
            action: {
              type: 'fill',
              target: semanticTarget('field'),
              value: { kind: 'random' },
            },
          },
        ],
      },
      '无法在派发前确定性解析',
    ],
    [
      'invalid selection values',
      {
        steps: [
          { action: { type: 'select_option', target: semanticTarget('field'), values: 'x' } },
        ],
      },
      '必须是数组',
    ],
    [
      'invalid page anchor',
      { steps: [{ action: { type: 'navigate', pageAnchor: {} } }] },
      'pageAnchor 无效',
    ],
  ])('rejects %s', (_name, script, message) => {
    expect(() => buildSemanticBrowserSteps(script)).toThrow(message);
  });

  it('rejects invalid navigation, effect declarations and expanded limits', () => {
    expect(() =>
      buildSemanticBrowserSteps(
        { steps: [{ action: { type: 'navigate', pageAnchor: { pageId: 'other' } } }] },
        {},
        { origin: 'https://example.test' },
        { id: 'page-1', routeTemplate: '/' }
      )
    ).toThrow('不在当前冻结页面任务内');
    expect(() =>
      buildSemanticBrowserSteps(
        { steps: [{ action: { type: 'navigate', pageAnchor: { pageId: 'page-1' } } }] },
        {},
        {},
        { id: 'page-1' }
      )
    ).toThrow('缺少 origin 或 routeTemplate');
    expect(() =>
      buildSemanticBrowserSteps({
        sideEffects: [],
        steps: [{ sideEffectId: 'missing', action: { type: 'click' } }],
      })
    ).toThrow('缺少有界 affectedItems');
    expect(() =>
      buildSemanticBrowserSteps({
        sideEffects: [{ id: 'many', affectedItems: { kind: 'many' } }],
        steps: [{ sideEffectId: 'many', action: { type: 'click' } }],
      })
    ).toThrow('超出当前 Agent task 单项写入授权边界');
    expect(() =>
      buildSemanticBrowserSteps({
        steps: Array.from({ length: 101 }, () => ({ action: 'observe' })),
      })
    ).toThrow('100 步上限');
  });

  it.each([
    [{}, '缺少冻结 policy evaluation'],
    [
      {
        policyEvaluationId: 'evaluation',
        policyVersion: 'v1',
        policyResult: 'denied',
        policyProjectionSha256: HASH_A,
      },
      '缺少冻结 policy evaluation',
    ],
    [
      {
        policyEvaluationId: 'evaluation',
        policyVersion: 'v1',
        policyResult: 'auto_allowed',
        policyProjectionSha256: HASH_A,
        script: effectScript({ kind: 'invalid', reversibility: 'reversible' }),
      },
      'kind 无效',
    ],
    [
      {
        policyEvaluationId: 'evaluation',
        policyVersion: 'v1',
        policyResult: 'auto_allowed',
        policyProjectionSha256: HASH_A,
        script: effectScript({ kind: 'create', reversibility: 'invalid' }),
      },
      'reversibility 无效',
    ],
    [
      {
        policyEvaluationId: 'evaluation',
        policyVersion: 'v1',
        policyResult: 'auto_allowed',
        policyProjectionSha256: HASH_A,
        deployment: { environment: 'unknown', origin: 'https://example.test' },
      },
      'environment',
    ],
  ])('rejects an invalid side-effect authorization snapshot', (overrides, message) => {
    expect(() =>
      buildRunTaskProjection(baseTodo({ script: effectScript(), ...overrides }), 'task')
    ).toThrow(message);
  });
});

function baseTodo(overrides: Partial<CoordinatorTodo> = {}): CoordinatorTodo {
  return {
    runId: 'run-1',
    runLifecycle: 'running',
    runStateVersion: 2,
    businessVersionId: 'version-1',
    deploymentRevisionId: 'deployment-revision-1',
    browserJobId: 'browser-job-1',
    browserSessionId: 'browser-session-1',
    todoId: 'todo-1',
    todoStateVersion: 1,
    todoKey: 'todo-key',
    input: {},
    inputSecretRefs: [],
    authContext: {},
    scriptRevisionId: 'script-revision-1',
    script: { steps: [] },
    pageRevisionId: 'page-revision-1',
    page: { id: 'page-1', routeTemplate: '/' },
    deployment: {
      environment: 'test',
      origin: 'https://example.test',
      apiToken: 'must-not-leak',
    },
    ...overrides,
  };
}

function semanticTarget(value: unknown) {
  return {
    semantic: 'target',
    candidates: [{ strategy: 'role', role: 'button', name: value }],
    expected: { visible: true },
  };
}

function effectScript(
  declaration: Record<string, unknown> = {
    kind: 'create',
    reversibility: 'reversible',
  }
) {
  return {
    sideEffects: [{ id: 'effect-1', affectedItems: { kind: 'single' }, ...declaration }],
    steps: [{ id: 'write', sideEffectId: 'effect-1', action: { type: 'click' } }],
  };
}
