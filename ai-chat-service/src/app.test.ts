import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildApp } from './app.js';
import type { AiChatServiceConfig } from './config/service-config.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildApp', () => {
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
      providers: {},
    };
    const first = await buildApp({
      configPath,
      dataDir: join(root, 'first'),
      serviceConfig,
      skipBackups: true,
      skipPreflight: true,
      trustedPluginLockPath,
    });
    const second = await buildApp({
      configPath,
      dataDir: join(root, 'second'),
      serviceConfig,
      skipBackups: true,
      skipPreflight: true,
      trustedPluginLockPath,
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
    } finally {
      await Promise.all([first.close(), second.close()]);
      if (previousKey === undefined) delete process.env.NEBULA_BUILD_APP_KEY;
      else process.env.NEBULA_BUILD_APP_KEY = previousKey;
    }
  }, 30_000);
});
