import {
  CallId,
  LlmAdapter,
} from '../../../ai-chat-service/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildApp } from '../../../ai-chat-service/dist/app.js';
import { createHarnessRuntime } from '../../../ai-chat-service/dist/harness/runtime.js';

class SemanticJourneyAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider };
  }

  async *stream(options) {
    const input = findSchemaObject(options.messages);
    if (!input) throw new Error('Semantic journey Agent input was not found');
    const plan = JSON.parse(await readFile(planPath, 'utf8'));
    const toolResults = options.messages.flatMap((message) =>
      message.content.filter((block) => block.type === 'tool-result')
    );
    const isAuthoring = input.schema === 'nebula.ai-e2e.authoring-task-input/1.0';
    const isVerification = input.schema === 'nebula.ai-e2e.authoring-verification-input/1.0';
    const isFormalRun = input.schema === 'nebula.ai-e2e.page-task-input/1.0';
    const shouldExecute =
      isAuthoring || isVerification || (isFormalRun && plan.formalResult !== 'outcome_unknown');
    const authorizedSteps = Array.isArray(input.authorizedSteps) ? input.authorizedSteps : [];
    const authorizedStep = authorizedSteps[toolResults.length];
    const stepId =
      authorizedStep?.stepId ??
      (isAuthoring
        ? 'observe-current-page'
        : isVerification
          ? 'verify-current-page'
          : 'script-observe');
    const expectedToolCalls = authorizedSteps.length || 1;
    const call =
      shouldExecute && toolResults.length < expectedToolCalls
        ? { name: 'nebula__browser_control__operation_execute', args: { stepId } }
        : {
            name: 'submit_result',
            args: {
              result: isAuthoring
                ? (plan.authoringOutput ?? buildBootstrapAuthoringOutput(input))
                : {
                    result: isFormalRun ? plan.formalResult : 'succeeded',
                    reasonClass:
                      isFormalRun && plan.formalResult === 'outcome_unknown'
                        ? 'connection_lost_after_dispatch'
                        : 'acceptance_passed',
                    summary:
                      isFormalRun && plan.formalResult === 'outcome_unknown'
                        ? 'The browser outcome cannot be proven'
                        : 'Semantic browser verification passed',
                    ...(isFormalRun ? { confirmedOutputsJson: '{}' } : {}),
                  },
            },
          };
    const id = CallId(`semantic-${Date.now()}-${toolResults.length}`);
    const args = JSON.stringify(call.args);
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: args };
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name: call.name, arguments: args },
    };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

function buildBootstrapAuthoringOutput(input) {
  const script = input.workspace?.functionalScripts?.[0];
  const scenario = input.workspace?.scenarios?.[0];
  const module = input.workspace?.functionalModules?.[0];
  const businessModule = input.workspace?.businessModules?.[0];
  const page = input.workspace?.pages?.[0];
  const scriptPayload = script?.currentRevision?.payload;
  const scenarioPayload = scenario?.currentRevision?.payload;
  const modulePayload = module?.currentRevision?.payload;
  const pagePayload = page?.currentRevision?.payload;
  const pageId = scriptPayload?.pageScope?.entryPageId;
  const moduleId = script?.functionalModuleId;
  const versionId = input.workspace?.version?.id;
  if (
    !script ||
    !scenario ||
    !module ||
    !businessModule ||
    !page ||
    !scriptPayload ||
    !scenarioPayload ||
    !modulePayload ||
    !pagePayload ||
    !pageId ||
    !moduleId ||
    !versionId
  ) {
    throw new Error('Bootstrap workspace did not expose its starter executable graph');
  }
  const chatPageId = deterministicUuid(versionId, 'page:ai-chat');
  const modules = [
    ['monitoring', '监控总览', '验证应用导航、浏览器连接状态、实时画面和运行状态'],
    ['browser-control', '浏览器控制', '验证控制面板、当前 URL 与安全只读操作入口'],
    ['ai-chat', 'AI 对话', '验证会话区域、消息输入框和发送按钮'],
    ['history-logs', '历史与日志', '验证操作日志、历史区域及明确空状态'],
    ['interaction', '页面交互', '验证交互入口及选中状态可理解'],
    ['dom-elements', 'DOM Elements', '验证 DOM 元素区域提供表格或明确空状态'],
  ].map(([key, name, goal], index) => ({
    key,
    name,
    goal,
    moduleId: index === 0 ? moduleId : deterministicUuid(versionId, `module:${key}`),
    scriptId: index === 0 ? script.id : deterministicUuid(versionId, `script:${key}`),
    sortOrder: index,
    pageId: key === 'ai-chat' ? chatPageId : pageId,
    targetUrl:
      key === 'ai-chat'
        ? `${String(input.request?.currentUrl).replace(/\/$/, '')}/#/chat`
        : input.request?.currentUrl,
  }));
  const scriptFor = (entry) => ({
    ...scriptPayload,
    scriptKey: `${entry.key}.inspect`,
    name: `检查${entry.name}`,
    purpose: entry.goal,
    moduleId: entry.moduleId,
    pageScope: { ...scriptPayload.pageScope, entryPageId: entry.pageId },
    steps: [
      {
        id: `step_observe_${entry.key.replaceAll('-', '_')}`,
        name: `观察${entry.name}`,
        intent: entry.goal,
        action: { type: 'observe' },
        postconditions: [],
      },
    ],
  });
  const scenarios = [
    {
      key: 'startup-monitoring',
      name: '启动与监控',
      moduleIndexes: [0, 1],
    },
    {
      key: 'panel-inspection',
      name: '面板巡检',
      moduleIndexes: [1, 3, 4, 5],
    },
    {
      key: 'ai-chat-entry',
      name: 'AI 对话入口',
      moduleIndexes: [2],
    },
    {
      key: 'route-recovery',
      name: '路由恢复',
      moduleIndexes: [0, 2],
    },
  ];
  const scenarioPayloadFor = (definition) => ({
    ...scenarioPayload,
    scenarioKey: definition.key,
    name: definition.name,
    purpose: `根据 PRD 验证${definition.name}`,
    calls: definition.moduleIndexes.map((index) => ({
      callKey: `inspect_${modules[index].key.replaceAll('-', '_')}`,
      functionalScriptId: modules[index].scriptId,
      inputBindings: {},
    })),
    edges: definition.moduleIndexes.slice(1).map((_, index) => ({
      fromCallKey: `inspect_${modules[definition.moduleIndexes[index]].key.replaceAll('-', '_')}`,
      toCallKey: `inspect_${modules[definition.moduleIndexes[index + 1]].key.replaceAll('-', '_')}`,
      condition: { kind: 'on_success' },
    })),
  });
  const proposals = [
    {
      operation: 'create',
      assetType: 'page_definition',
      assetId: chatPageId,
      assetKey: 'ai-chat',
      candidatePayload: {
        ...pagePayload,
        name: 'AI 对话页',
        routeTemplate: '/debug/#/chat',
        recognition: { status: 'prd_bound', landmarks: ['会话区域', '消息输入框', '发送按钮'] },
      },
      category: 'requirement',
      reason: '从 PRD 识别并绑定 AI 对话独立 URL',
      targetUrl: `${String(input.request?.currentUrl).replace(/\/$/, '')}/#/chat`,
      targetPageDefinitionId: chatPageId,
    },
    {
      assetType: 'functional_module',
      assetId: module.id,
      baseRevisionId: module.currentRevision.id,
      candidatePayload: {
        ...modulePayload,
        name: modules[0].name,
        goal: modules[0].goal,
        sortOrder: 0,
      },
      category: 'requirement',
      reason: '将起始模块收敛为 PRD 的监控总览模块',
      targetUrl: input.request?.currentUrl,
      targetPageDefinitionId: pageId,
      targetFunctionalModuleId: moduleId,
    },
    {
      assetType: 'functional_script',
      assetId: script.id,
      baseRevisionId: script.currentRevision.id,
      candidatePayload: scriptFor(modules[0]),
      category: 'script',
      reason: '为监控总览生成结构化测试脚本',
      targetUrl: input.request?.currentUrl,
      targetPageDefinitionId: pageId,
      targetFunctionalModuleId: moduleId,
    },
    ...modules.slice(1).flatMap((entry) => [
      {
        operation: 'create',
        assetType: 'functional_module',
        assetId: entry.moduleId,
        assetKey: entry.key,
        businessModuleId: businessModule.id,
        primaryPageDefinitionId: entry.pageId,
        candidatePayload: {
          ...modulePayload,
          name: entry.name,
          goal: entry.goal,
          sortOrder: entry.sortOrder,
          primaryPageDefinitionId: entry.pageId,
        },
        category: 'requirement',
        reason: `从 PRD 拆分${entry.name}模块`,
        targetUrl: entry.targetUrl,
        targetPageDefinitionId: entry.pageId,
      },
      {
        operation: 'create',
        assetType: 'functional_script',
        assetId: entry.scriptId,
        assetKey: `${entry.key}.inspect`,
        name: `检查${entry.name}`,
        functionalModuleId: entry.moduleId,
        candidatePayload: scriptFor(entry),
        category: 'script',
        reason: `为${entry.name}自动生成结构化测试脚本`,
        targetUrl: entry.targetUrl,
        targetPageDefinitionId: entry.pageId,
      },
    ]),
    ...scenarios.map((definition, index) => ({
      ...(index === 0
        ? {
            assetType: 'test_scenario',
            assetId: scenario.id,
            baseRevisionId: scenario.currentRevision.id,
          }
        : {
            operation: 'create',
            assetType: 'test_scenario',
            assetId: deterministicUuid(versionId, `scenario:${definition.key}`),
            assetKey: definition.key,
            name: definition.name,
          }),
      candidatePayload: scenarioPayloadFor(definition),
      category: 'scenario_add',
      reason: `从 PRD 生成${definition.name}场景`,
      targetUrl: modules[definition.moduleIndexes[0]].targetUrl,
      targetPageDefinitionId: modules[definition.moduleIndexes[0]].pageId,
      targetFunctionalModuleId: modules[definition.moduleIndexes[0]].moduleId,
    })),
  ];
  return {
    status: 'candidate_ready',
    summary: '已依据初始 PRD 与浏览器证据拆分 2 个页面、6 个模块、6 个脚本和 4 个场景',
    category: 'scenario_add',
    proposalsJson: JSON.stringify(proposals),
    validationPlanJson: JSON.stringify({
      strategy: 'static_then_real_browser_verification',
      pageCount: 2,
      moduleCount: 6,
      scriptCount: 6,
      scenarioCount: 4,
    }),
    potentialSideEffectsJson: '{}',
  };
}

function deterministicUuid(namespace, key) {
  const hex = createHash('sha256').update(`${namespace}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

const TASK_INPUT_SCHEMAS = new Set([
  'nebula.ai-e2e.authoring-task-input/1.0',
  'nebula.ai-e2e.authoring-verification-input/1.0',
  'nebula.ai-e2e.page-task-input/1.0',
]);

function findSchemaObject(value) {
  if (typeof value === 'string') {
    try {
      return findSchemaObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  if (TASK_INPUT_SCHEMAS.has(value.schema)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findSchemaObject(child);
    if (found) return found;
  }
  return undefined;
}

const configPath = required('AI_CHAT_E2E_CONFIG_PATH');
const dataDir = required('AI_CHAT_E2E_DATA_DIR');
const trustedPluginLockPath = required('AI_CHAT_E2E_PLUGIN_LOCK_PATH');
const gatewayUrl = required('PROXY_ADAPTER_URL');
const planPath = required('AI_E2E_JOURNEY_PLAN_PATH');
const adapter = new SemanticJourneyAdapter();
const app = await buildApp({
  configPath,
  dataDir,
  trustedPluginLockPath,
  skipBackups: true,
  skipPreflight: true,
  serviceConfig: {
    port: 0,
    host: '127.0.0.1',
    logLevel: 'error',
    gatewayUrl,
    corsOrigins: ['*'],
    skillDirectories: [],
  },
  harnessFactory: (options) =>
    createHarnessRuntime({
      ...options,
      piAi: { providers: {} },
      async configure(context) {
        await options.configure?.(context);
        context.llm.registerAdapter(['test'], adapter);
      },
    }),
});

let closing = false;
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  process.exitCode = 0;
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.stdout.write(`E2E_AI_CHAT_READY ${JSON.stringify({ url })}\n`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
