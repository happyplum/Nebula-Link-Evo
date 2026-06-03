import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { StreamPersistWorker } from '../services/stream-persist-worker.js';
import type { PendingJobInfo } from '@nebula-link-evo/shared';

describe('ConversationJobQueue API - getPendingJobs and cancelJob', () => {
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

  describe('getPendingJobs', () => {
    it('should return empty array for session with no jobs', () => {
      const pendingJobs = queue.getPendingJobs('session-1');
      expect(pendingJobs).toEqual([]);
      expect(Array.isArray(pendingJobs)).toBe(true);
    });

    it('should return queued jobs for a session', async () => {
      const execute1 = vi.fn().mockResolvedValue(undefined);
      const execute2 = vi.fn().mockResolvedValue(undefined);

      const jobId1 = await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
      const jobId2 = await queue.enqueue({ sessionId: 'session-1', execute: execute2 });

      const pendingJobs = queue.getPendingJobs('session-1');

      expect(pendingJobs).toHaveLength(2);
      expect(pendingJobs[0]).toMatchObject({
        jobId: jobId1,
        sessionId: 'session-1',
        status: expect.stringMatching(/^(queued|running)$/),
        createdAt: expect.any(String),
      });
      expect(pendingJobs[1]).toMatchObject({
        jobId: jobId2,
        sessionId: 'session-1',
        status: expect.stringMatching(/^(queued|running)$/),
        createdAt: expect.any(String),
      });
    });

    it('should only return jobs for the specified session', async () => {
      const execute1 = vi.fn().mockResolvedValue(undefined);
      const execute2 = vi.fn().mockResolvedValue(undefined);
      const execute3 = vi.fn().mockResolvedValue(undefined);

      await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
      await queue.enqueue({ sessionId: 'session-2', execute: execute2 });
      await queue.enqueue({ sessionId: 'session-3', execute: execute3 });

      const session1Jobs = queue.getPendingJobs('session-1');
      const session2Jobs = queue.getPendingJobs('session-2');
      const session4Jobs = queue.getPendingJobs('session-4');

      expect(session1Jobs).toHaveLength(1);
      expect(session1Jobs[0].sessionId).toBe('session-1');

      expect(session2Jobs).toHaveLength(1);
      expect(session2Jobs[0].sessionId).toBe('session-2');

      expect(session4Jobs).toHaveLength(0);
    });

    it('should not return completed jobs', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const jobId = await queue.enqueue({ sessionId: 'session-1', execute });

      await vi.runAllTimersAsync();

      const pendingJobs = queue.getPendingJobs('session-1');
      expect(pendingJobs).toHaveLength(0);
    });

    it('should not return failed jobs', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('Test error'));
      await queue.enqueue({ sessionId: 'session-1', execute });

      await Promise.resolve();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      const pendingJobs = queue.getPendingJobs('session-1');
      expect(pendingJobs).toHaveLength(0);
    });

    it('should not return cancelled jobs', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const jobId = await queue.enqueue({ sessionId: 'session-1', execute });

      queue.cancelJob(jobId);

      const pendingJobs = queue.getPendingJobs('session-1');
      expect(pendingJobs).toHaveLength(0);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a queued job and return true', async () => {
      let resolveExecute: () => void;
      const executePromise = new Promise<void>((resolve) => {
        resolveExecute = resolve;
      });
      const execute1 = vi.fn().mockReturnValue(executePromise);
      const execute2 = vi.fn().mockResolvedValue(undefined);

      const jobId1 = await queue.enqueue({ sessionId: 'session-1', execute: execute1 });
      const jobId2 = await queue.enqueue({ sessionId: 'session-1', execute: execute2 });

      await Promise.resolve();
      await Promise.resolve();

      const result = queue.cancelJob(jobId2);

      expect(result).toBe(true);

      const status = queue.getStatus(jobId2);
      expect(status?.status).toBe('cancelled');

      resolveExecute!();
      await vi.runAllTimersAsync();

      expect(execute2).not.toHaveBeenCalled();
    });

    it('should return false when job does not exist', () => {
      const result = queue.cancelJob('non-existent-job-id');
      expect(result).toBe(false);
    });

    it('should return false when job is already completed', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const jobId = await queue.enqueue({ sessionId: 'session-1', execute });

      await vi.runAllTimersAsync();

      const result = queue.cancelJob(jobId);
      expect(result).toBe(false);
    });

    it('should return false when job is already failed', async () => {
      const execute = vi.fn().mockRejectedValue(new Error('Test error'));
      const jobId = await queue.enqueue({ sessionId: 'session-1', execute });

      await Promise.resolve();
      await Promise.resolve();
      await vi.runAllTimersAsync();

      const result = queue.cancelJob(jobId);
      expect(result).toBe(false);
    });

    it('should return false when job is already cancelled', async () => {
      const execute = vi.fn().mockResolvedValue(undefined);
      const jobId = await queue.enqueue({ sessionId: 'session-1', execute });

      const result1 = queue.cancelJob(jobId);
      expect(result1).toBe(true);

      const result2 = queue.cancelJob(jobId);
      expect(result2).toBe(false);
    });
  });
});