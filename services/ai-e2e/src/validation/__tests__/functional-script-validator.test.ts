import { describe, expect, it } from 'vitest';
import { validateFunctionalScriptV1 } from '../functional-script-validator.js';

describe('functional script v1 validator', () => {
  it('接受 canonical 只读脚本', () => {
    expect(() => validateFunctionalScriptV1(validScript())).not.toThrow();
  });

  it.each([
    ['旧 module 字段', { moduleId: undefined, functionalModuleId: 'module-1' }, '未知字段'],
    ['空步骤', { steps: [] }, '$.steps 数量'],
    ['任意动作', { steps: [{ ...validStep(), action: { type: 'dom_script' } }] }, '不在白名单'],
    ['悬空副作用', { steps: [{ ...validStep(), sideEffectId: 'missing' }] }, '未引用'],
  ])('拒绝%s', (_label, override, message) => {
    expect(() => validateFunctionalScriptV1({ ...validScript(), ...override })).toThrow(message);
  });
});

function validScript(): Record<string, unknown> {
  return {
    schema: 'nebula.ai-e2e.functional-script/1.0',
    scriptKey: 'account.observe',
    name: '观察账号页',
    purpose: '读取账号页并验证其可访问',
    moduleId: 'module-1',
    pageScope: { entryPageId: 'page-1', allowedTransitions: [] },
    inputs: [],
    preconditions: [],
    steps: [validStep()],
    finalAssertions: [
      {
        id: 'assert_page_url',
        kind: 'page.url',
        expected: { kind: 'literal', value: '/' },
        comparator: 'contains',
        message: '页面 URL 可读取',
      },
    ],
    outputs: [],
    sideEffects: [],
  };
}

function validStep(): Record<string, unknown> {
  return {
    id: 'step_observe',
    name: '观察页面',
    intent: '采集当前页面状态',
    action: { type: 'observe' },
    postconditions: [],
  };
}
