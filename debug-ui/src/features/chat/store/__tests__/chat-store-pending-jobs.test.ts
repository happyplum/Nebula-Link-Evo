import { describe, it, expect } from 'vitest';
import { useChatStore } from '../chat.store.js';
import type { PendingJobInfo } from '@nebula-link-evo/shared';

describe('pendingJobs State Slice', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  describe('addPendingJob', () => {
    it('should add a new job to pending jobs for a session', () => {
      const job: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job);

      expect(useChatStore.getState().pendingJobs['session-1']).toEqual([job]);
    });

    it('should be idempotent - not add job if jobId already exists', () => {
      const job: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job);
      useChatStore
        .getState()
        .addPendingJob('session-1', { ...job, contentPreview: 'Different content' });

      expect(useChatStore.getState().pendingJobs['session-1']).toHaveLength(1);
      expect(useChatStore.getState().pendingJobs['session-1'][0].contentPreview).toBe(
        'Test content'
      );
    });

    it('should append job to existing jobs for same session', () => {
      const job1: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content 1',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };
      const job2: PendingJobInfo = {
        jobId: 'job-2',
        sessionId: 'session-1',
        messageId: 'msg-2',
        contentPreview: 'Test content 2',
        createdAt: '2024-01-01T01:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job1);
      useChatStore.getState().addPendingJob('session-1', job2);

      expect(useChatStore.getState().pendingJobs['session-1']).toHaveLength(2);
    });
  });

  describe('updateJobStarted', () => {
    it('should update job status to running', () => {
      const job: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job);
      useChatStore.getState().updateJobStarted('session-1', 'job-1');

      expect(useChatStore.getState().pendingJobs['session-1'][0].status).toBe('running');
    });

    it('should skip if job not found', () => {
      const job: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job);
      const beforeUpdate = useChatStore.getState().pendingJobs;

      useChatStore.getState().updateJobStarted('session-1', 'non-existent-job');

      expect(useChatStore.getState().pendingJobs).toEqual(beforeUpdate);
    });
  });

  describe('removePendingJob', () => {
    it('should remove job from pending jobs by jobId', () => {
      const job1: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content 1',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };
      const job2: PendingJobInfo = {
        jobId: 'job-2',
        sessionId: 'session-1',
        messageId: 'msg-2',
        contentPreview: 'Test content 2',
        createdAt: '2024-01-01T01:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job1);
      useChatStore.getState().addPendingJob('session-1', job2);
      useChatStore.getState().removePendingJob('session-1', 'job-1');

      expect(useChatStore.getState().pendingJobs['session-1']).toHaveLength(1);
      expect(useChatStore.getState().pendingJobs['session-1'][0].jobId).toBe('job-2');
    });

    it('should handle removing job from empty list gracefully', () => {
      useChatStore.getState().removePendingJob('session-1', 'job-1');
      expect(useChatStore.getState().pendingJobs['session-1']).toBeUndefined();
    });
  });

  describe('setPendingJobsFromSnapshot', () => {
    it('should replace entire pending jobs array for session', () => {
      const jobs1: PendingJobInfo[] = [
        {
          jobId: 'job-1',
          sessionId: 'session-1',
          messageId: 'msg-1',
          contentPreview: 'Test content 1',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'queued',
        },
      ];
      const jobs2: PendingJobInfo[] = [
        {
          jobId: 'job-2',
          sessionId: 'session-1',
          messageId: 'msg-2',
          contentPreview: 'Test content 2',
          createdAt: '2024-01-01T01:00:00Z',
          status: 'queued',
        },
        {
          jobId: 'job-3',
          sessionId: 'session-1',
          messageId: 'msg-3',
          contentPreview: 'Test content 3',
          createdAt: '2024-01-01T02:00:00Z',
          status: 'running',
        },
      ];

      useChatStore.getState().setPendingJobsFromSnapshot('session-1', jobs1);
      expect(useChatStore.getState().pendingJobs['session-1']).toEqual(jobs1);

      useChatStore.getState().setPendingJobsFromSnapshot('session-1', jobs2);
      expect(useChatStore.getState().pendingJobs['session-1']).toEqual(jobs2);
      expect(useChatStore.getState().pendingJobs['session-1']).toHaveLength(2);
    });

    it('should set empty array when snapshot has no jobs', () => {
      useChatStore.getState().setPendingJobsFromSnapshot('session-1', []);
      expect(useChatStore.getState().pendingJobs['session-1']).toEqual([]);
    });
  });

  describe('clearPendingJobs', () => {
    it('should delete the pending jobs entry for session', () => {
      const job: PendingJobInfo = {
        jobId: 'job-1',
        sessionId: 'session-1',
        messageId: 'msg-1',
        contentPreview: 'Test content',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      };

      useChatStore.getState().addPendingJob('session-1', job);
      expect(useChatStore.getState().pendingJobs['session-1']).toBeDefined();

      useChatStore.getState().clearPendingJobs('session-1');
      expect(useChatStore.getState().pendingJobs['session-1']).toBeUndefined();
    });

    it('should handle clearing non-existent session gracefully', () => {
      const beforeClear = useChatStore.getState().pendingJobs;
      useChatStore.getState().clearPendingJobs('non-existent-session');
      expect(useChatStore.getState().pendingJobs).toEqual(beforeClear);
    });
  });
});
