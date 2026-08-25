import { CallId, LlmAdapter } from '@deepseek-ai/dsh-llm';
import { appendFile } from 'node:fs/promises';
import { buildApp } from '../../dist/app.js';
import { createHarnessRuntime } from '../../dist/harness/runtime.js';

class DeterministicBrowserAdapter extends LlmAdapter {
  providerInfo(provider) {
    return { id: provider, name: provider };
  }

  async *stream(options) {
    const isAgentTask = options.tools?.some((tool) => tool.name === 'submit_result');
    if (!isAgentTask) {
      if (chatStartedPath) await appendFile(chatStartedPath, 'started\n', 'utf8');
      await abortableDelay(chatDelayMs, options.signal);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'E2E assistant response' };
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'E2E assistant response' },
      };
      yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 4 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }
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

const chatDelayMs = Number(process.env.E2E_CHAT_DELAY_MS ?? 0);
if (!Number.isSafeInteger(chatDelayMs) || chatDelayMs < 0 || chatDelayMs > 30_000) {
  throw new Error('E2E_CHAT_DELAY_MS must be an integer between 0 and 30000');
}
const chatStartedPath = process.env.E2E_CHAT_STARTED_PATH;

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

const configuredPort = Number(process.env.AI_CHAT_E2E_PORT ?? 0);
if (!Number.isSafeInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
  throw new Error('AI_CHAT_E2E_PORT must be a valid port');
}
const url = await app.listen({ host: '127.0.0.1', port: configuredPort });
process.stdout.write(`E2E_AI_CHAT_READY ${JSON.stringify({ url })}\n`);
await shutdownComplete;

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function abortableDelay(delayMs, signal) {
  if (delayMs === 0) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      reject(new DOMException(String(signal?.reason ?? 'Aborted'), 'AbortError'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
  });
}
