import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp as buildProxyApp } from '../../src/server.js';
import { AgentTaskRepository } from '../../../ai-chat-service/src/agent-tasks/repository.js';
import { AgentTaskService } from '../../../ai-chat-service/src/agent-tasks/service.js';
import type { AgentTaskExecutor } from '../../../ai-chat-service/src/agent-tasks/types.js';
import agentTaskRoutes from '../../../ai-chat-service/src/plugins/routes/api/agent-tasks.js';
import { AgentTaskClient } from '../../../ai-e2e/src/infrastructure/agent-task-client.js';
import { SemanticBrowserClient } from '../../../ai-e2e/src/infrastructure/semantic-browser-client.js';

describe('canonical cross-service control planes', () => {
  let root: string;
  let proxyUrl: string;
  let aiChatUrl: string;
  let proxyApp: Awaited<ReturnType<typeof buildProxyApp>>;
  const aiChatApp = Fastify({ logger: false });
  const repository = new AgentTaskRepository(':memory:');
  const executor: AgentTaskExecutor = {
    execute: async () => ({
      output: { ok: true },
      terminationReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, modelTurns: 1, toolCalls: 0 },
      toolCalls: [],
    }),
  };
  const agentTaskService = new AgentTaskService(repository, executor, {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'nebula-control-plane-e2e-'));
    proxyApp = await buildProxyApp({ dataDir: join(root, 'proxy'), skipBackups: true });
    proxyUrl = await proxyApp.listen({ host: '127.0.0.1', port: 0 });
    await aiChatApp.register(agentTaskRoutes, {
      prefix: '/api/v1',
      service: agentTaskService,
      serviceVersion: 'e2e',
      localControlPlane: true,
    });
    aiChatUrl = await aiChatApp.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await Promise.all([proxyApp.close(), aiChatApp.close()]);
    await agentTaskService.close();
    await rm(root, { recursive: true, force: true });
  });

  it('uses the canonical ai-chat-service Agent task API over real HTTP', async () => {
    const client = new AgentTaskClient({ baseUrl: aiChatUrl, timeoutMs: 10_000 });
    const capabilities = await client.getCapabilities();
    expect(capabilities).toMatchObject({
      service: 'ai-chat-service',
      protocols: { 'nebula.ai.agent-task': { major: 1 } },
    });

    const created = await client.createTask(
      {
        schema: 'nebula.ai.agent-task/1.0',
        clientTaskId: 'cross-service-e2e',
        modelRole: 'decision',
        input: { objective: 'verify canonical control plane' },
        responseSchema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
        toolPolicy: { allow: [] },
        skillPolicy: { allow: [] },
        budgets: { maxDurationMs: 10_000, maxModelTurns: 1, maxToolCalls: 0 },
      },
      'cross-service-agent-task'
    );
    const current = await client.getTask(created.taskId);
    expect(['created', 'running', 'completed']).toContain(current.status);

    const legacy = await fetch(`${aiChatUrl}/api/agent-tasks/${created.taskId}`);
    expect(legacy.status).toBe(404);
  });

  it('uses the canonical proxy browser session and lease API with real Chromium', async () => {
    const client = new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 });
    const capabilities = await client.getCapabilities();
    expect(capabilities).toMatchObject({
      service: 'proxy-adapter',
      protocols: { browserExecution: { major: 1 } },
    });

    const session = await client.createSession('cross-service-browser-session', {
      viewport: { width: 1024, height: 768 },
    });
    expect(session.status).toBe('active');
    expect(session.tabs).toHaveLength(1);

    const issued = await client.createLease(session.id, 'cross-service-browser-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    expect(issued.tokenIssued).toBe(true);
    expect(issued.token).toBeTruthy();
    await client.revokeLease(
      session.id,
      issued.lease.id,
      issued.token!,
      'cross-service-browser-lease-revoke'
    );
    const closeLease = await client.createLease(session.id, 'cross-service-browser-close-lease', {
      mode: 'control',
      ttlSeconds: 30,
    });
    const closed = await client.closeSession(session.id, 'cross-service-browser-session-close', {
      leaseId: closeLease.lease.id,
      leaseToken: closeLease.token!,
    });
    expect(closed.status).toBe('closed');

    const legacy = await fetch(`${proxyUrl}/api/capabilities`);
    expect(legacy.status).toBe(404);
  });
});
