export function functionalScriptFixture(input: {
  scriptKey: string;
  name: string;
  purpose?: string;
  moduleId: string;
  pageId: string;
  steps?: Record<string, unknown>[];
  sideEffects?: Record<string, unknown>[];
}): Record<string, unknown> {
  return {
    schema: 'nebula.ai-e2e.functional-script/1.0',
    scriptKey: input.scriptKey,
    name: input.name,
    purpose: input.purpose ?? `验证${input.name}`,
    moduleId: input.moduleId,
    pageScope: { entryPageId: input.pageId, allowedTransitions: [] },
    inputs: [],
    preconditions: [],
    steps: input.steps ?? [observeStep()],
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
    sideEffects: input.sideEffects ?? [],
  };
}

export function observeStep(): Record<string, unknown> {
  return {
    id: 'step_observe',
    name: '观察页面',
    intent: '采集当前页面状态',
    action: { type: 'observe' },
    postconditions: [],
  };
}
