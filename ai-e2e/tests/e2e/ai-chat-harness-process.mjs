import {
  CallId,
  LlmAdapter,
} from '../../../ai-chat-service/node_modules/@deepseek-ai/dsh-llm/lib/index.js';
import { readFile } from 'node:fs/promises';
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
  const scriptPayload = script?.currentRevision?.payload;
  const scenarioPayload = scenario?.currentRevision?.payload;
  const pageId = scriptPayload?.pageScope?.entryPageId;
  const moduleId = script?.functionalModuleId;
  if (!script || !scenario || !scriptPayload || !scenarioPayload || !pageId || !moduleId) {
    throw new Error('Bootstrap workspace did not expose its starter executable graph');
  }
  return {
    status: 'candidate_ready',
    summary: 'Generated executable bootstrap candidates from the frozen workspace',
    category: 'repair',
    proposalsJson: JSON.stringify([
      {
        assetType: 'functional_script',
        assetId: script.id,
        baseRevisionId: script.currentRevision.id,
        candidatePayload: {
          ...scriptPayload,
          purpose: '采集起始页面证据并完成真实浏览器验收',
        },
        category: 'repair',
        reason: 'Bootstrap executable script',
        targetUrl: input.request?.currentUrl,
        targetPageDefinitionId: pageId,
        targetFunctionalModuleId: moduleId,
      },
      {
        assetType: 'test_scenario',
        assetId: scenario.id,
        baseRevisionId: scenario.currentRevision.id,
        candidatePayload: { ...scenarioPayload, name: '已验证的初始页面检查' },
        category: 'repair',
        reason: 'Bootstrap executable scenario',
        targetUrl: input.request?.currentUrl,
        targetPageDefinitionId: pageId,
        targetFunctionalModuleId: moduleId,
      },
    ]),
    validationPlanJson: JSON.stringify({ strategy: 'real_browser_verification' }),
    potentialSideEffectsJson: '{}',
  };
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
