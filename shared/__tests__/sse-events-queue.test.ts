/**
 * TDD Tests for Queue Event Types
 * RED Phase: Write failing tests first
 */

import type {
  PendingJobInfo,
  SessionSnapshotEvent,
  JobQueuedEvent,
  JobStartedEvent,
  JobCancelledEvent,
  JobCompletedEvent,
  SessionEvent,
  SessionEventType,
} from '../types/sse-events.js';
import { eventToSSEFormat } from '../types/sse-events.js';

describe('PendingJobInfo type', () => {
  it('should create a valid PendingJobInfo object', () => {
    const job: PendingJobInfo = {
      jobId: 'job-123',
      sessionId: 'session-456',
      messageId: 'msg-789',
      contentPreview: 'Hello world',
      createdAt: '2024-01-01T00:00:00Z',
      status: 'queued',
    };

    // Type assertion - should pass if PendingJobInfo is correctly defined
    expect(job.jobId).toBe('job-123');
    expect(job.status).toBe('queued');
  });

  it('should accept status "running"', () => {
    const job: PendingJobInfo = {
      jobId: 'job-123',
      sessionId: 'session-456',
      messageId: 'msg-789',
      contentPreview: 'Hello world',
      createdAt: '2024-01-01T00:00:00Z',
      status: 'running',
    };

    expect(job.status).toBe('running');
  });
});

describe('Queue event types - discriminated union', () => {
  it('JobQueuedEvent should satisfy SessionEvent', () => {
    const event: JobQueuedEvent = {
      type: 'job.queued',
      seq: 1,
      sessionId: 'session-123',
      job: {
        jobId: 'job-123',
        sessionId: 'session-123',
        messageId: 'msg-789',
        contentPreview: 'Test',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      },
    };

    const sessionEvent: SessionEvent = event;
    expect(sessionEvent.type).toBe('job.queued');
  });

  it('JobStartedEvent should satisfy SessionEvent', () => {
    const event: JobStartedEvent = {
      type: 'job.started',
      seq: 2,
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const sessionEvent: SessionEvent = event;
    expect(sessionEvent.type).toBe('job.started');
  });

  it('JobCancelledEvent should satisfy SessionEvent', () => {
    const event: JobCancelledEvent = {
      type: 'job.cancelled',
      seq: 3,
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const sessionEvent: SessionEvent = event;
    expect(sessionEvent.type).toBe('job.cancelled');
  });

  it('JobCompletedEvent should satisfy SessionEvent', () => {
    const event: JobCompletedEvent = {
      type: 'job.completed',
      seq: 4,
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const sessionEvent: SessionEvent = event;
    expect(sessionEvent.type).toBe('job.completed');
  });
});

describe('SessionEventType alias', () => {
  it('should include job.queued type literal', () => {
    const eventType: SessionEventType = 'job.queued';
    expect(eventType).toBe('job.queued');
  });

  it('should include job.started type literal', () => {
    const eventType: SessionEventType = 'job.started';
    expect(eventType).toBe('job.started');
  });

  it('should include job.cancelled type literal', () => {
    const eventType: SessionEventType = 'job.cancelled';
    expect(eventType).toBe('job.cancelled');
  });

  it('should include job.completed type literal', () => {
    const eventType: SessionEventType = 'job.completed';
    expect(eventType).toBe('job.completed');
  });
});

describe('SessionSnapshotEvent with pendingJobs', () => {
  it('should accept optional pendingJobs field', () => {
    const snapshot: SessionSnapshotEvent = {
      type: 'session.snapshot',
      sessionId: 'session-123',
      messages: [],
      state: 'idle',
      pendingJobs: [
        {
          jobId: 'job-1',
          sessionId: 'session-123',
          messageId: 'msg-1',
          contentPreview: 'Hello',
          createdAt: '2024-01-01T00:00:00Z',
          status: 'queued',
        },
      ],
    };

    expect(snapshot.pendingJobs).toHaveLength(1);
    expect(snapshot.pendingJobs?.[0].jobId).toBe('job-1');
  });

  it('should work without pendingJobs field', () => {
    const snapshot: SessionSnapshotEvent = {
      type: 'session.snapshot',
      sessionId: 'session-123',
      messages: [],
      state: 'idle',
    };

    expect(snapshot.pendingJobs).toBeUndefined();
  });
});

describe('eventToSSEFormat with queue events', () => {
  it('should format JobQueuedEvent correctly', () => {
    const event: JobQueuedEvent = {
      type: 'job.queued',
      sessionId: 'session-123',
      job: {
        jobId: 'job-123',
        sessionId: 'session-123',
        messageId: 'msg-789',
        contentPreview: 'Test',
        createdAt: '2024-01-01T00:00:00Z',
        status: 'queued',
      },
    };

    const formatted = eventToSSEFormat(event, 'evt-123');

    expect(formatted.event).toBe('job.queued');
    expect(formatted.id).toBe('evt-123');
    expect(() => JSON.parse(formatted.data)).not.toThrow();

    const parsed = JSON.parse(formatted.data);
    expect(parsed.type).toBe('job.queued');
    expect(parsed.sessionId).toBe('session-123');
  });

  it('should format JobStartedEvent correctly', () => {
    const event: JobStartedEvent = {
      type: 'job.started',
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const formatted = eventToSSEFormat(event);

    expect(formatted.event).toBe('job.started');
    const parsed = JSON.parse(formatted.data);
    expect(parsed.type).toBe('job.started');
    expect(parsed.jobId).toBe('job-123');
  });

  it('should format JobCancelledEvent correctly', () => {
    const event: JobCancelledEvent = {
      type: 'job.cancelled',
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const formatted = eventToSSEFormat(event);

    expect(formatted.event).toBe('job.cancelled');
    const parsed = JSON.parse(formatted.data);
    expect(parsed.type).toBe('job.cancelled');
  });

  it('should format JobCompletedEvent correctly', () => {
    const event: JobCompletedEvent = {
      type: 'job.completed',
      sessionId: 'session-123',
      jobId: 'job-123',
    };

    const formatted = eventToSSEFormat(event);

    expect(formatted.event).toBe('job.completed');
    const parsed = JSON.parse(formatted.data);
    expect(parsed.type).toBe('job.completed');
  });
});