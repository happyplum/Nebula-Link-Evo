import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import type { AiChatServiceConfig } from './config/service-config.js';
import { createHarnessRuntime, publicMcpToolName } from './harness/index.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildApp', () => {
  it('rejects a non-loopback bind before loading runtime resources', async () => {
    const serviceConfig: AiChatServiceConfig = {
      port: 3001,
      host: '0.0.0.0',
      logLevel: 'error',
      gatewayUrl: 'http://127.0.0.1:3000',
      corsOrigins: [],
      skillDirectories: [],
    };

    await expect(buildApp({ serviceConfig })).rejects.toThrow(
      'ai-chat-service must bind to a loopback host'
    );
  });

  it('creates independent Cordis roots and state stores for two Fastify instances', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nebula-build-app-'));
    roots.push(root);
    const configPath = join(root, 'config.json');
    const trustedPluginLockPath = join(root, 'trusted-harness-plugins.lock.json');
    await writeFile(
      trustedPluginLockPath,
      JSON.stringify({
        schema: 'nebula.ai.trusted-harness-plugins/1.0',
        abi: { cordis: '4.0.1', deepseekHarness: '0.1.1-rc.2' },
        plugins: [],
        mcp: [],
      })
    );
    await writeFile(
      configPath,
      JSON.stringify({
        version: '2.0',
        providers: {
          nvidia: {
            enabled: true,
            apiKey: '{NEBULA_BUILD_APP_KEY}',
            baseUrl: 'http://127.0.0.1:9/v1',
            models: {
              test: { type: 'decision', capabilities: ['decision'] },
            },
          },
        },
        defaults: { mode: 'unified', decision: 'nvidia/test' },
        mcp: { enabled: false, servers: {} },
        settings: {
          timeout: 1_000,
          maxRetries: 3,
          temperature: 0,
          maxTokens: 64,
          maxSteps: 2,
        },
      })
    );
    const previousKey = process.env.NEBULA_BUILD_APP_KEY;
    process.env.NEBULA_BUILD_APP_KEY = 'test-only';
    const serviceConfig: AiChatServiceConfig = {
      port: 0,
      host: '127.0.0.1',
      logLevel: 'error',
      gatewayUrl: 'http://127.0.0.1:3000',
      corsOrigins: [],
      skillDirectories: [],
    };
    const harnessFactory: typeof createHarnessRuntime = async (options) => {
      const runtime = await createHarnessRuntime({ ...options, mcp: [] });
      const toolNames = [
        'browser-control.operation_execute',
        'browser-control.operation_get',
        'browser-control.operation_cancel',
      ].map((toolName) => publicMcpToolName('gateway', toolName));
      return { ...runtime, transportToolNames: () => toolNames };
    };
    const first = await buildApp({
      configPath,
      dataDir: join(root, 'first'),
      serviceConfig,
      skipBackups: true,
      skipPreflight: true,
      trustedPluginLockPath,
      harnessFactory,
    });
    const second = await buildApp({
      configPath,
      dataDir: join(root, 'second'),
      serviceConfig,
      skipBackups: true,
      skipPreflight: true,
      trustedPluginLockPath,
      harnessFactory,
    });
    try {
      await Promise.all([first.ready(), second.ready()]);
      expect(first.harnessRuntime.context).not.toBe(second.harnessRuntime.context);
      expect(first.conversationDatabase).not.toBe(second.conversationDatabase);
      first.conversationManager.createSession({
        id: 'first-only',
        title: 'first',
        provider: 'nvidia',
        model: 'test',
      });
      expect(first.conversationManager.getSession('first-only')).not.toBeNull();
      expect(second.conversationManager.getSession('first-only')).toBeNull();
      await expect(first.inject({ method: 'GET', url: '/health' })).resolves.toMatchObject({
        statusCode: 200,
      });
      const removedRoutes = await Promise.all([
        first.inject({ method: 'GET', url: '/api/chat/sessions' }),
        first.inject({ method: 'POST', url: '/api/ai/generate', payload: { prompt: 'old' } }),
        first.inject({ method: 'POST', url: '/api/test-ai', payload: {} }),
        first.inject({ method: 'GET', url: '/api/verify-keys' }),
      ]);
      expect(removedRoutes.map((response) => response.statusCode)).toEqual([404, 404, 404, 404]);
    } finally {
      await Promise.all([first.close(), second.close()]);
      if (previousKey === undefined) delete process.env.NEBULA_BUILD_APP_KEY;
      else process.env.NEBULA_BUILD_APP_KEY = previousKey;
    }
  }, 30_000);
});
