import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import type { DecisionClient } from '../clients/types.js';
import type { ResolvedConfig } from '../config/schema.js';
import apiChatRoutes from '../plugins/routes/api/chat/index.js';
import errorHandler from '../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../plugins/02-swagger.plugin.js';

const mockConfig: ResolvedConfig = {
  version: '1.0',
  providers: {
    kimi: {
      enabled: true,
      apiKey: 'test-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      npmPackage: '@ai-sdk/openai-compatible',
      models: {
        'moonshot-v1-vision-preview': {
          type: 'vision',
          capabilities: ['vision', 'decision'],
          temperature: 0.4,
          maxTokens: 2000,
        },
      },
    },
  },
  mcp: { enabled: false, servers: {} },
  defaults: {
    vision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
    decision: { provider: 'kimi', model: 'moonshot-v1-vision-preview' },
  },
};

describe('DELETE /sessions/:sessionId/jobs/:jobId', () => {
  let app: ReturnType<typeof Fastify>;
  let manager: ConversationManager;
  let chatHandler: ChatHandler;
  let jobQueue: ConversationJobQueue;

  beforeEach(() => {
    app = Fastify();
    manager = new ConversationManager(':memory:');
    manager.initialize();

    const mockDecisionClient = {
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
      decide: vi.fn(),
      decideStream: vi.fn(),
    } as unknown as DecisionClient;

    chatHandler = new ChatHandler(manager, mockConfig);
    (chatHandler as any).resolveDecisionModel = () => mockDecisionClient;

    const persistWorker = new StreamPersistWorker();
    jobQueue = new ConversationJobQueue(persistWorker);

    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('conversationManager', manager);
    app.decorate('chatHandler', chatHandler);
    app.decorate('jobQueue', jobQueue);

    app.register(apiChatRoutes);
  });

  afterEach(async () => {
    await manager.close();
    app.close();
  });

  it('should return 200 and cancel a queued job', async () => {
    const session = manager.createSession({
      title: 'Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // First job: blocks the session so subsequent jobs stay queued
    let resolveBlocker: () => void;
    const blockerPromise = new Promise<void>((resolve) => {
      resolveBlocker = resolve;
    });
    await jobQueue.enqueue({
      sessionId: session.id,
      messageId: 'msg-blocker',
      contentPreview: 'blocker',
      execute: async () => {
        await blockerPromise;
      },
    });

    // Wait for first job to start running and hold the session lock
    await vi.waitFor(() => {
      const pending = jobQueue.getPendingJobs(session.id);
      expect(pending.some((j) => j.status === 'running')).toBe(true);
    });

    // Second job: stays queued because session is locked by the first
    const jobId = await jobQueue.enqueue({
      sessionId: session.id,
      messageId: 'msg-1',
      contentPreview: 'test',
      execute: async () => {},
    });

    // Verify second job is queued
    const job = jobQueue.getStatus(jobId);
    expect(job?.status).toBe('queued');

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session.id}/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body).toEqual({ success: true, jobId });

    // Verify job status is cancelled
    const cancelledJob = jobQueue.getStatus(jobId);
    expect(cancelledJob?.status).toBe('cancelled');

    // Clean up blocker
    resolveBlocker!();
  });

  it('should return 404 for non-existent job', async () => {
    const session = manager.createSession({
      title: 'Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session.id}/jobs/non-existent-job-id`,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('not found');
  });

  it('should return 404 when job belongs to different session', async () => {
    const session1 = manager.createSession({
      title: 'Session 1',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });
    const session2 = manager.createSession({
      title: 'Session 2',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const jobId = await jobQueue.enqueue({
      sessionId: session1.id,
      messageId: 'msg-1',
      contentPreview: 'test',
      execute: async () => {},
    });

    // Try to cancel job using session2's ID
    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session2.id}/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('not found');
  });

  it('should return 409 when job is already running', async () => {
    const session = manager.createSession({
      title: 'Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // Enqueue a job that blocks (never resolves) so it stays running
    let resolveExecution: () => void;
    const executionPromise = new Promise<void>((resolve) => {
      resolveExecution = resolve;
    });

    const jobId = await jobQueue.enqueue({
      sessionId: session.id,
      messageId: 'msg-1',
      contentPreview: 'test',
      execute: async () => {
        await executionPromise;
      },
    });

    // Wait for the job to start running
    await vi.waitFor(() => {
      const job = jobQueue.getStatus(jobId);
      expect(job?.status).toBe('running');
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session.id}/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('already running');

    // Clean up
    resolveExecution!();
  });

  it('should return 404 when job is already completed', async () => {
    const session = manager.createSession({
      title: 'Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    // Enqueue a job that resolves immediately
    const jobId = await jobQueue.enqueue({
      sessionId: session.id,
      messageId: 'msg-1',
      contentPreview: 'test',
      execute: async () => {
        // completes immediately
      },
    });

    // Wait for job to complete
    await vi.waitFor(() => {
      const job = jobQueue.getStatus(jobId);
      expect(job?.status).toBe('completed');
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session.id}/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('no longer queued');
  });

  it('should return 404 when job is already cancelled', async () => {
    const session = manager.createSession({
      title: 'Test',
      provider: 'kimi',
      model: 'moonshot-v1-vision-preview',
    });

    const jobId = await jobQueue.enqueue({
      sessionId: session.id,
      messageId: 'msg-1',
      contentPreview: 'test',
      execute: async () => {},
    });

    // Cancel first time
    jobQueue.cancel(jobId);

    const response = await app.inject({
      method: 'DELETE',
      url: `/sessions/${session.id}/jobs/${jobId}`,
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('no longer queued');
  });
});
