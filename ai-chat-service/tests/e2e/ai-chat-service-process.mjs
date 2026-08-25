import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm';
import { buildApp } from '../../dist/app.js';
import { createHarnessRuntime } from '../../dist/harness/runtime.js';

class DeterministicBrowserAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider };
  }

  async *stream(options) {
    const browserTurn = !options.messages.some((message) =>
      message.content.some((block) => block.type === 'tool-result')
    );
    const id = CallId(browserTurn ? 'browser-call-1' : 'submit-call-1');
    const name = browserTurn ? 'nebula__browser_control__operation_execute' : 'submit_result';
    const args = JSON.stringify(
      browserTurn ? { stepId: 'navigate-target' } : { result: { status: 'navigated' } }
    );
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args };
    yield {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id, name, arguments: args },
    };
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 5 } };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}

const configPath = requireEnvironment('AI_CHAT_E2E_CONFIG_PATH');
const dataDir = requireEnvironment('AI_CHAT_E2E_DATA_DIR');
const trustedPluginLockPath = requireEnvironment('AI_CHAT_E2E_PLUGIN_LOCK_PATH');
const gatewayUrl = requireEnvironment('PROXY_ADAPTER_URL');
const adapter = new DeterministicBrowserAdapter();
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
let resolveShutdown;
const shutdownComplete = new Promise((resolve) => {
  resolveShutdown = resolve;
});
const shutdown = async () => {
  if (closing) return;
  closing = true;
  await app.close();
  resolveShutdown();
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

const url = await app.listen({ host: '127.0.0.1', port: 0 });
process.stdout.write(`E2E_AI_CHAT_READY ${JSON.stringify({ url })}\n`);
await shutdownComplete;

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
