import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withE2EResources } from '../../../../tools/e2e-process-lifecycle.mjs';

process.exitCode = await withE2EResources(
  {
    workspaceRoot: fileURLToPath(new URL('../../../..', import.meta.url)),
    name: 'ai-e2e-ui',
  },
  async (scope) => {
    const root = scope.root;
    const proxyPort = await availablePort();
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    const proxy = scope.spawn(
      process.execPath,
      [fileURLToPath(new URL('../../../proxy-adapter/dist/server.js', import.meta.url))],
      {
        cwd: root,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PROXY_PORT: String(proxyPort),
          TEST_MODE: 'true',
          LOG_LEVEL: 'error',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    await scope.wait(
      waitForHttp(`${proxyUrl}/api/v1/health`, proxy, 'proxy-adapter', scope.signal)
    );

    const aiDataDir = join(root, 'ai-chat');
    const configPath = join(root, 'config.json');
    const pluginLockPath = join(root, 'trusted-harness-plugins.lock.json');
    const planPath = join(root, 'journey-plan.json');
    await mkdir(aiDataDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(testConfig()), 'utf8');
    await writeFile(pluginLockPath, JSON.stringify(testPluginLock(proxyUrl)), 'utf8');
    await writeFile(planPath, JSON.stringify({ formalResult: 'succeeded' }), 'utf8');
    const aiChat = scope.spawn(
      process.execPath,
      [fileURLToPath(new URL('../../tests/e2e/ai-chat-harness-process.mjs', import.meta.url))],
      {
        cwd: root,
        env: {
          ...process.env,
          AI_CHAT_E2E_CONFIG_PATH: configPath,
          AI_CHAT_E2E_DATA_DIR: aiDataDir,
          AI_CHAT_E2E_PLUGIN_LOCK_PATH: pluginLockPath,
          AI_E2E_JOURNEY_PLAN_PATH: planPath,
          PROXY_ADAPTER_URL: proxyUrl,
          E2E_TEST_API_KEY: 'deterministic-test-key',
          TEST_MODE: 'true',
          LOG_LEVEL: 'error',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    const aiChatUrl = await scope.wait(waitForReady(aiChat, 'E2E_AI_CHAT_READY '));
    const childEnvironment = { ...process.env };
    delete childEnvironment.NO_COLOR;
    Object.assign(childEnvironment, {
      AI_E2E_UI_TEST_PORT: String(await availablePort()),
      AI_E2E_UI_TEST_DB_PATH: join(root, 'ai-e2e.sqlite'),
      AI_E2E_UI_COORDINATOR_ENABLED: 'true',
      AI_CHAT_SERVICE_URL: aiChatUrl,
      PROXY_ADAPTER_URL: proxyUrl,
      NEBULA_E2E_RUN_ROOT: root,
      AI_E2E_UI_PACKAGE_DIR: fileURLToPath(new URL('..', import.meta.url)),
    });

    const playwrightCli = fileURLToPath(
      new URL('../node_modules/@playwright/test/cli.js', import.meta.url)
    );
    const child = scope.spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: childEnvironment,
      stdio: 'inherit',
      windowsHide: true,
    });
    return await scope.waitForExit(child);
  }
);

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!port) throw new Error('Failed to allocate ai-e2e UI test port');
  return port;
}

async function waitForHttp(url, child, name, signal) {
  let logs = '';
  let startupError;
  child.once('error', (error) => {
    startupError = error;
  });
  child.stdout?.on('data', (chunk) => (logs += String(chunk)));
  child.stderr?.on('data', (chunk) => (logs += String(chunk)));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (startupError) throw startupError;
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${name} exited before ready: ${logs}`);
    try {
      if ((await globalThis.fetch(url, { signal: AbortSignal.timeout(1_000) })).ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${name} startup timed out: ${logs}`);
}

async function waitForReady(child, prefix) {
  let logs = '';
  let stdout = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Service startup timed out: ${logs}`)),
      30_000
    );
    const failed = () => {
      clearTimeout(timeout);
      reject(new Error(`Service exited before ready: ${logs}`));
    };
    child.once('exit', failed);
    child.once('error', failed);
    child.stderr?.on('data', (chunk) => (logs += String(chunk)));
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      logs += text;
      stdout += text;
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith(prefix)) continue;
        clearTimeout(timeout);
        child.off('exit', failed);
        child.off('error', failed);
        resolve(String(JSON.parse(line.slice(prefix.length)).url));
        return;
      }
      stdout = stdout.slice(Math.max(0, stdout.lastIndexOf('\n') + 1));
    });
  });
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
          decision: { type: 'decision', capabilities: ['decision'], maxTokens: 24_000 },
          vision: { type: 'vision', capabilities: ['vision'], maxTokens: 8_000 },
        },
      },
    },
    defaults: { mode: 'unified', decision: 'test/decision', vision: 'test/vision' },
    settings: {
      timeout: 30_000,
      maxRetries: 1,
      temperature: 0,
      maxTokens: 24_000,
      maxSteps: 20,
      contextWindowTokens: 40_000,
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
