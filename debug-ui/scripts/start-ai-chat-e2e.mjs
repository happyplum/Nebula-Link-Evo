import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayUrl = requireEnvironment('PROXY_ADAPTER_URL');
const port = requireEnvironment('AI_CHAT_E2E_PORT');
const root = await mkdtemp(join(tmpdir(), 'nebula-debug-ui-ai-chat-e2e-'));
const configPath = join(root, 'config.json');
const trustedPluginLockPath = join(root, 'trusted-harness-plugins.lock.json');
await writeFile(configPath, JSON.stringify(testConfig()), 'utf8');
await writeFile(trustedPluginLockPath, JSON.stringify(testPluginLock(gatewayUrl)), 'utf8');

const fixture = fileURLToPath(
  new URL('../../ai-chat-service/tests/e2e/ai-chat-service-process.mjs', import.meta.url)
);
const child = spawn(process.execPath, [fixture], {
  env: {
    ...process.env,
    AI_CHAT_E2E_CONFIG_PATH: configPath,
    AI_CHAT_E2E_DATA_DIR: join(root, 'data'),
    AI_CHAT_E2E_PLUGIN_LOCK_PATH: trustedPluginLockPath,
    AI_CHAT_E2E_PORT: port,
    PROXY_ADAPTER_URL: gatewayUrl,
    E2E_TEST_API_KEY: 'deterministic-test-key',
    TEST_MODE: 'true',
    LOG_LEVEL: 'error',
  },
  stdio: 'inherit',
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal));
}

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve(signal ? 0 : (code ?? 1)));
});
await rm(root, { recursive: true, force: true });
process.exitCode = exitCode;

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function testConfig() {
  return {
    version: '2.0',
    providers: {
      test: {
        enabled: true,
        apiKey: '{E2E_TEST_API_KEY}',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: {
          decision: { type: 'decision', capabilities: ['decision'], maxTokens: 2_000 },
        },
      },
    },
    defaults: { mode: 'unified', decision: 'test/decision' },
    settings: {
      timeout: 30_000,
      maxRetries: 1,
      temperature: 0,
      maxTokens: 2_000,
      maxSteps: 5,
      contextWindowTokens: 10_000,
    },
    mcp: { enabled: false, servers: {} },
  };
}

function testPluginLock(proxyUrl) {
  return {
    schema: 'nebula.ai.trusted-harness-plugins/1.0',
    abi: { cordis: '4.0.1', deepseekHarness: '0.1.1-rc.2' },
    plugins: [],
    mcp: [
      {
        transport: 'streamable-http',
        serverName: 'gateway',
        url: new URL('/mcp', proxyUrl).toString(),
        headers: {},
      },
    ],
  };
}
