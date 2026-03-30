import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import { ConversationManager } from '../conversation/manager.js';
import { ServiceUnavailableError } from '../errors/http-errors.js';
import { ProviderError } from '../services/provider/errors.js';

describe('ConversationJobQueue', () => {
  let queue: ConversationJobQueue;
  let persistWorker: StreamPersistWorker;

  beforeEach(() => {
    persistWorker = new StreamPersistWorker();
    queue = new ConversationJobQueue(persistWorker);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await persistWorker.shutdown();
  });

  it('should enqueue a job and return a jobId immediately', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await queue.enqueue({ sessionId: 'session-1', execute });
    
    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe('string');
    
    const status = queue.getStatus(jobId);
    expect(status).toBeDefined();
    expect(status?.sessionId).toBe('session-1');
    expect(status?.status).toBe('queued');
  });

  it('should execute job in background (non-blocking)', async () => {
    let resolveExecute: () => void;
    const executePromise = new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
    const execute = vi.fn().mockReturnValue(executePromise);
    
    const jobId = await queue.enqueue({ sessionId: 'session-1', execute });
    
    // Allow event loop to tick so the background execution starts
    await Promise.resolve();
    await Promise.resolve();
    
    let status = queue.getStatus(jobId);
    expect(status?.status).toBe('running');
    expect(execute).toHaveBeenCalledWith({ maxToolLoops: 10 });
    
    // Complete the job
    resolveExecute!();
    await vi.runAllTimersAsync();
    
    status = queue.getStatus(jobId);
    expect(status?.status).toBe('completed');
  });

  it('should enforce session locks (sequential execution per session)', async () => {
    let resolveExecute1: () => void;
    const executePromise1 = new Promise<void>((resolve) => {
      resolveExecute1 = resolve;
    });
    const execute1 = vi.fn().mockReturnValue(executePromise1);
    
    const execute2 = vi.fn().mockResolvedValue(undefined);
    
    const jobId1 = await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
    const jobId2 = await queue.enqueue({ sessionId: 'session-1', execute: execute2 });
    
    await Promise.resolve();
    await Promise.resolve();
    
    expect(queue.getStatus(jobId1)?.status).toBe('running');
    expect(queue.getStatus(jobId2)?.status).toBe('queued');
    expect(execute1).toHaveBeenCalled();
    expect(execute2).not.toHaveBeenCalled();
    
    // Complete first job
    resolveExecute1!();
    await vi.runAllTimersAsync();
    
    expect(queue.getStatus(jobId1)?.status).toBe('completed');
    expect(queue.getStatus(jobId2)?.status).toBe('completed');
    expect(execute2).toHaveBeenCalled();
  });

  it('should allow parallel execution for different sessions', async () => {
    let resolveExecute1: () => void;
    const executePromise1 = new Promise<void>((resolve) => {
      resolveExecute1 = resolve;
    });
    const execute1 = vi.fn().mockReturnValue(executePromise1);
    
    let resolveExecute2: () => void;
    const executePromise2 = new Promise<void>((resolve) => {
      resolveExecute2 = resolve;
    });
    const execute2 = vi.fn().mockReturnValue(executePromise2);
    
    const jobId1 = await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
    const jobId2 = await queue.enqueue({ sessionId: 'session-2', execute: execute2 });
    
    await Promise.resolve();
    await Promise.resolve();
    
    expect(queue.getStatus(jobId1)?.status).toBe('running');
    expect(queue.getStatus(jobId2)?.status).toBe('running');
    expect(execute1).toHaveBeenCalled();
    expect(execute2).toHaveBeenCalled();
    
    resolveExecute1!();
    resolveExecute2!();
  });

  it('should cleanup old jobs and locks after TTL (10 minutes)', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await queue.enqueue({ sessionId: 'session-1', execute });
    
    await vi.runAllTimersAsync();
    
    expect(queue.getStatus(jobId)?.status).toBe('completed');
    
    // Advance time by 11 minutes
    await vi.advanceTimersByTimeAsync(11 * 60 * 1000);
    
    queue.cleanup();
    
    expect(queue.getStatus(jobId)).toBeUndefined();
  });

  it('should cancel a queued job', async () => {
    let resolveExecute1: () => void;
    const executePromise1 = new Promise<void>((resolve) => {
      resolveExecute1 = resolve;
    });
    const execute1 = vi.fn().mockReturnValue(executePromise1);
    
    const execute2 = vi.fn().mockResolvedValue(undefined);
    
    const jobId1 = await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
    const jobId2 = await queue.enqueue({ sessionId: 'session-1', execute: execute2 });
    
    await Promise.resolve();
    await Promise.resolve();
    
    queue.cancel(jobId2);
    
    expect(queue.getStatus(jobId2)?.status).toBe('cancelled');
    
    resolveExecute1!();
    await vi.runAllTimersAsync();
    
    expect(execute2).not.toHaveBeenCalled();
  });

  it('should throw ServiceUnavailableError when queue is full', async () => {
    // Fill the queue
    for (let i = 0; i < 1000; i++) {
      await queue.enqueue({ sessionId: `session-${i}`, execute: vi.fn().mockResolvedValue(undefined) });
    }
    
    await expect(queue.enqueue({ sessionId: 'session-1001', execute: vi.fn() }))
      .rejects.toThrow(ServiceUnavailableError);
  });

  it('should sync session state status to running/completed with jobId', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Session State Sync',
      provider: 'test',
      model: 'test-model',
    });

    let resolveExecute: () => void;
    const executePromise = new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
    const execute = vi.fn().mockReturnValue(executePromise);

    const jobId = await queue.enqueue({ sessionId: session.id, execute });

    let runningState = await manager.getSessionState(session.id);
    for (let i = 0; i < 10 && runningState?.status !== 'running'; i++) {
      await Promise.resolve();
      runningState = await manager.getSessionState(session.id);
    }
    expect(runningState?.status).toBe('running');
    expect(runningState?.jobId).toBe(jobId);

    resolveExecute!();
    await vi.runAllTimersAsync();

    const completedState = await manager.getSessionState(session.id);
    expect(completedState?.status).toBe('completed');
    await manager.close();
  });

  it('should mark session state as blocked when job throws a blocked error shape', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Session Blocked',
      provider: 'test',
      model: 'test-model',
    });

    const blockedError = Object.assign(new Error('blocked'), {
      blockReason: 'waiting_for_user_input' as const,
      waitingFor: 'user_message' as const,
    });

    const execute = vi.fn().mockRejectedValue(blockedError);
    const jobId = await queue.enqueue({ sessionId: session.id, execute });

    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(queue.getStatus(jobId)?.status).toBe('completed');

    const state = await manager.getSessionState(session.id);
    expect(state?.status).toBe('blocked');
    expect(state?.agentState?.blockReason).toBe('waiting_for_user_input');
    expect(state?.agentState?.waitingFor).toBe('user_message');
    await manager.close();
  });

  it('should retry job up to 3 times and then mark session blocked with job_error', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Session Retry',
      provider: 'test',
      model: 'test-model',
    });

    let attempts = 0;
    const execute = vi.fn().mockImplementation(async () => {
      attempts++;
      throw new Error(`boom-${attempts}`);
    });

    const jobId = await queue.enqueue({ sessionId: session.id, execute });

    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(queue.getStatus(jobId)?.status).toBe('failed');
    expect(attempts).toBe(3);

    const state = await manager.getSessionState(session.id);
    expect(state?.status).toBe('blocked');
    expect(state?.agentState?.blockReason).toBe('job_error');
    expect(state?.agentState?.retryCount).toBe(3);
    const lastError = (state?.agentState as unknown as { lastError?: string } | undefined)?.lastError;
    expect(lastError).toBe('boom-3');
    await manager.close();
  });

  it('should block immediately on ProviderError without retry', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Provider Error',
      provider: 'test',
      model: 'test-model',
    });

    const providerError = new ProviderError(
      'PROVIDER_INIT_FAILED',
      'openai-compatible',
      'factory is not a function',
    );

    const execute = vi.fn().mockRejectedValue(providerError);
    const jobId = await queue.enqueue({ sessionId: session.id, execute });

    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    // Execute called exactly once — no retries
    expect(execute).toHaveBeenCalledTimes(1);
    expect(queue.getStatus(jobId)?.status).toBe('completed');

    const state = await manager.getSessionState(session.id);
    expect(state?.status).toBe('blocked');
    expect(state?.agentState?.blockReason).toBe('api_error');
    expect(state?.agentState?.schema_version).toBe(1);
    const agentState = state?.agentState as Record<string, unknown> | undefined;
    expect(agentState?.lastError).toContain('openai-compatible');
    expect(agentState?.lastError).toContain('Provider Error');
    // retryCount should be absent (undefined) — no retry happened
    expect(agentState?.retryCount).toBeUndefined();
    await manager.close();
  });

  it('should include provider alias and details in ProviderError lastError', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Provider Error Details',
      provider: 'test',
      model: 'test-model',
    });

    const providerError = new ProviderError(
      'PROVIDER_CONFIG_INVALID',
      'kimi',
      { missing: 'apiKey' },
    );

    const execute = vi.fn().mockRejectedValue(providerError);
    await queue.enqueue({ sessionId: session.id, execute });

    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    const state = await manager.getSessionState(session.id);
    const agentState = state?.agentState as Record<string, unknown> | undefined;
    expect(agentState?.lastError).toContain('kimi');
    expect(agentState?.lastError).toContain('initialization failed');
    expect(state?.agentState?.schema_version).toBe(1);
    await manager.close();
  });

  it('should still retry non-ProviderError errors (3 attempts then blocked)', async () => {
    const manager = new ConversationManager(':memory:');
    manager.initialize();
    const session = manager.createSession({
      title: 'Non-Provider Retry',
      provider: 'test',
      model: 'test-model',
    });

    let attempts = 0;
    const execute = vi.fn().mockImplementation(async () => {
      attempts++;
      throw new Error(`generic-${attempts}`);
    });

    const jobId = await queue.enqueue({ sessionId: session.id, execute });

    await Promise.resolve();
    await Promise.resolve();
    await vi.runAllTimersAsync();

    expect(attempts).toBe(3);
    expect(queue.getStatus(jobId)?.status).toBe('failed');

    const state = await manager.getSessionState(session.id);
    expect(state?.status).toBe('blocked');
    expect(state?.agentState?.blockReason).toBe('job_error');
    expect(state?.agentState?.retryCount).toBe(3);
    expect(state?.agentState?.schema_version).toBe(1);
    await manager.close();
  });
});
