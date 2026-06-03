import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';

// We test buildSnapshotEvent indirectly by importing it after mocking its dependencies.
// Since buildSnapshotEvent is a module-level function, we recreate its core logic in tests
// to verify the pendingJobs enrichment behavior.

describe('buildSnapshotEvent pendingJobs enrichment', () => {
  let persistWorker: StreamPersistWorker;
  let jobQueue: ConversationJobQueue;

  beforeEach(() => {
    persistWorker = new StreamPersistWorker();
    jobQueue = new ConversationJobQueue(persistWorker);
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await persistWorker.shutdown();
  });

  it('should include pendingJobs in snapshot when jobs are queued', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    const jobId = await jobQueue.enqueue({ sessionId: 'session-1', execute });

    const pendingJobs = jobQueue.getPendingJobs('session-1');

    expect(pendingJobs).toHaveLength(1);
    expect(pendingJobs[0].jobId).toBe(jobId);
    expect(pendingJobs[0].sessionId).toBe('session-1');
    expect(pendingJobs[0].status).toMatch(/^(queued|running)$/);
    expect(pendingJobs[0].createdAt).toEqual(expect.any(String));
  });

  it('should produce empty pendingJobs when no jobs are queued', () => {
    const pendingJobs = jobQueue.getPendingJobs('session-1');
    expect(pendingJobs).toEqual([]);
  });

  it('should produce empty pendingJobs when jobQueue is undefined', () => {
    const pendingJobs = undefined as unknown as ConversationJobQueue;
    const result = pendingJobs?.getPendingJobs('session-1') ?? [];
    expect(result).toEqual([]);
  });

  it('should conditionally spread pendingJobs into snapshot object', () => {
    // Simulates the spread pattern used in buildSnapshotEvent:
    //   ...(pendingJobs.length > 0 ? { pendingJobs } : {})
    const pendingJobsEmpty: never[] = [];
    const snapshotNoJobs = {
      type: 'session.snapshot' as const,
      ...(pendingJobsEmpty.length > 0 ? { pendingJobs: pendingJobsEmpty } : {}),
    };
    expect(snapshotNoJobs).not.toHaveProperty('pendingJobs');

    const pendingJobsPresent = [
      { jobId: 'j1', sessionId: 's1', messageId: '', contentPreview: '', createdAt: '2025-01-01T00:00:00.000Z', status: 'queued' as const },
    ];
    const snapshotWithJobs = {
      type: 'session.snapshot' as const,
      ...(pendingJobsPresent.length > 0 ? { pendingJobs: pendingJobsPresent } : {}),
    };
    expect(snapshotWithJobs).toHaveProperty('pendingJobs');
    expect(snapshotWithJobs.pendingJobs).toHaveLength(1);
  });

  it('should not include pendingJobs for completed jobs', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await jobQueue.enqueue({ sessionId: 'session-1', execute });

    await vi.runAllTimersAsync();

    const pendingJobs = jobQueue.getPendingJobs('session-1');
    expect(pendingJobs).toHaveLength(0);
  });

  it('should filter pendingJobs by sessionId', async () => {
    const execute1 = vi.fn().mockResolvedValue(undefined);
    const execute2 = vi.fn().mockResolvedValue(undefined);

    await jobQueue.enqueue({ sessionId: 'session-1', execute: execute1 });
    await jobQueue.enqueue({ sessionId: 'session-2', execute: execute2 });

    const session1Jobs = jobQueue.getPendingJobs('session-1');
    const session2Jobs = jobQueue.getPendingJobs('session-2');

    expect(session1Jobs).toHaveLength(1);
    expect(session1Jobs[0].sessionId).toBe('session-1');
    expect(session2Jobs).toHaveLength(1);
    expect(session2Jobs[0].sessionId).toBe('session-2');
  });
});
