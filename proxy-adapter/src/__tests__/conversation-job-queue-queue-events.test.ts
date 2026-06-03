import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import { SessionEventHub } from '../services/session-event-hub.js';

describe('ConversationJobQueue - Queue Events via SessionEventHub', () => {
  let queue: ConversationJobQueue;
  let persistWorker: StreamPersistWorker;
  let eventHub: SessionEventHub;

  beforeEach(() => {
    SessionEventHub.resetInstance();
    eventHub = SessionEventHub.getInstance();
    persistWorker = new StreamPersistWorker();
    queue = new ConversationJobQueue(persistWorker, eventHub);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await persistWorker.shutdown();
    SessionEventHub.resetInstance();
  });

  it('emits job.queued event on enqueue', async () => {
    const callback = vi.fn();
    eventHub.subscribe('session-1', callback);

    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await queue.enqueue({
      sessionId: 'session-1',
      execute,
      messageId: 'msg-1',
      contentPreview: 'Hello world',
    });

    // Allow microtask queue to flush
    await vi.advanceTimersByTimeAsync(0);

    // Find the job.queued event
    const queuedCalls = callback.mock.calls.filter(
      (call: [unknown]) => (call[0] as { type: string }).type === 'job.queued'
    );
    expect(queuedCalls.length).toBe(1);

    const event = queuedCalls[0][0] as {
      type: string;
      sessionId: string;
      job: { jobId: string; sessionId: string; messageId: string; contentPreview: string; status: string };
    };
    expect(event.type).toBe('job.queued');
    expect(event.sessionId).toBe('session-1');
    expect(event.job.jobId).toBe(jobId);
    expect(event.job.sessionId).toBe('session-1');
    expect(event.job.messageId).toBe('msg-1');
    expect(event.job.contentPreview).toBe('Hello world');
    expect(event.job.status).toBe('queued');
  });

  it('emits job.queued with empty messageId/contentPreview when not provided', async () => {
    const callback = vi.fn();
    eventHub.subscribe('session-2', callback);

    await queue.enqueue({
      sessionId: 'session-2',
      execute: vi.fn().mockResolvedValue(undefined),
    });

    await vi.advanceTimersByTimeAsync(0);

    const queuedCalls = callback.mock.calls.filter(
      (call: [unknown]) => (call[0] as { type: string }).type === 'job.queued'
    );
    expect(queuedCalls.length).toBe(1);
    const event = queuedCalls[0][0] as {
      job: { messageId: string; contentPreview: string };
    };
    expect(event.job.messageId).toBe('');
    expect(event.job.contentPreview).toBe('');
  });

  it('emits job.started and job.completed during successful execution', async () => {
    const callback = vi.fn();
    eventHub.subscribe('session-3', callback);

    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await queue.enqueue({
      sessionId: 'session-3',
      execute,
      messageId: 'msg-3',
      contentPreview: 'Test',
    });

    // Wait for job to complete
    await vi.runAllTimersAsync();

    const typedCalls = callback.mock.calls.map((call: [unknown]) => call[0] as { type: string });

    // Should have: job.queued, job.started, job.completed
    const startedCalls = typedCalls.filter((e) => e.type === 'job.started');
    const completedCalls = typedCalls.filter((e) => e.type === 'job.completed');

    expect(startedCalls.length).toBe(1);
    expect(startedCalls[0].type).toBe('job.started');
    expect((startedCalls[0] as { sessionId: string; jobId: string }).sessionId).toBe('session-3');
    expect((startedCalls[0] as { sessionId: string; jobId: string }).jobId).toBe(jobId);

    expect(completedCalls.length).toBe(1);
    expect(completedCalls[0].type).toBe('job.completed');
    expect((completedCalls[0] as { sessionId: string; jobId: string }).sessionId).toBe('session-3');
    expect((completedCalls[0] as { sessionId: string; jobId: string }).jobId).toBe(jobId);
  });

  it('emits job.cancelled on cancel()', async () => {
    const callback = vi.fn();
    eventHub.subscribe('session-4', callback);

    // Block execution so job stays in queue
    let resolveExecute: () => void;
    const executePromise = new Promise<void>((resolve) => {
      resolveExecute = resolve;
    });
    const execute = vi.fn().mockReturnValue(executePromise);

    const jobId = await queue.enqueue({
      sessionId: 'session-4',
      execute,
      messageId: 'msg-4',
      contentPreview: 'Cancel me',
    });

    // Flush microtasks so job starts running (acquires lock)
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    // Cancel the running job
    queue.cancel(jobId);

    // Resolve the execute promise so job can finish
    resolveExecute!();
    await vi.runAllTimersAsync();

    const cancelledCalls = callback.mock.calls.filter(
      (call: [unknown]) => (call[0] as { type: string }).type === 'job.cancelled'
    );
    expect(cancelledCalls.length).toBe(1);

    const event = cancelledCalls[0][0] as {
      type: string;
      sessionId: string;
      jobId: string;
    };
    expect(event.type).toBe('job.cancelled');
    expect(event.sessionId).toBe('session-4');
    expect(event.jobId).toBe(jobId);
  });

  it('does not emit events when eventHub is not provided', async () => {
    // Create queue without eventHub
    const queueNoHub = new ConversationJobQueue(persistWorker);

    // This should not throw
    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await queueNoHub.enqueue({
      sessionId: 'session-5',
      execute,
    });

    // Wait for completion
    await vi.runAllTimersAsync();

    // Verify job completed normally
    const status = queueNoHub.getStatus(jobId);
    expect(status?.status).toBe('completed');

    // No events emitted — the eventHub has no subscribers anyway, but confirm no crash
    expect(eventHub.getSubscriberCount('session-5')).toBe(0);
  });
});
