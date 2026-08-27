import { describe, expect, it, vi } from 'vitest';
import type { DatabaseManager } from '../conversation/db.js';
import type { SessionEventHub } from '../conversation/session-event-hub.js';
import type { SessionState } from '../conversation/types.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';
import { ConversationJobQueue } from './conversation-job-queue.js';
import { ProviderError, PROVIDER_ERRORS } from './provider/errors.js';
import type { StreamPersistWorker } from './stream-persist-worker.js';

vi.mock('./logger.js', () => ({
  createWorkerLogger: () => ({ error: vi.fn() }),
}));

describe('ConversationJobQueue', () => {
  it('runs jobs through the scheduler and never overwrites a durable paused state', async () => {
    const fixture = createFixture();
    const pausedJob = await fixture.queue.enqueue({
      sessionId: 'paused-session',
      messageId: 'message-1',
      contentPreview: 'pause',
      idempotencyKey: 'idem-1',
      execute: async () => {
        const current = fixture.dao.states.get('paused-session');
        if (!current) throw new Error('running session state was not persisted');
        fixture.dao.states.set('paused-session', {
          ...current,
          status: 'paused',
        });
      },
    });
    await waitForJob(fixture.queue, pausedJob, 'completed');

    expect(fixture.dao.states.get('paused-session')).toMatchObject({
      status: 'paused',
      jobId: pausedJob,
    });
    expect(fixture.scheduler.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: pausedJob,
        ownerType: 'chat',
        ownerId: 'paused-session',
        messageId: 'message-1',
        idempotencyKey: 'idem-1',
      })
    );
    expect(fixture.scheduler.wait).toHaveBeenCalledWith(pausedJob);
    expect(fixture.scheduler.complete).toHaveBeenCalledWith(pausedJob);
    expect(fixture.eventHub.emitJobQueued).toHaveBeenCalledWith(
      'paused-session',
      expect.objectContaining({ jobId: pausedJob, messageId: 'message-1' })
    );
    expect(fixture.eventHub.emitJobStarted).toHaveBeenCalledWith('paused-session', pausedJob);
    expect(fixture.eventHub.emitJobCompleted).toHaveBeenCalledWith('paused-session', pausedJob);
    expect(fixture.queue.getPendingJobs('paused-session')).toEqual([]);

    const normalJob = await fixture.queue.enqueue({
      sessionId: 'normal-session',
      execute: async () => {},
    });
    await waitForJob(fixture.queue, normalJob, 'completed');
    expect(fixture.dao.states.get('normal-session')).toMatchObject({
      status: 'completed',
      jobId: normalJob,
    });
    expect(fixture.queue.getStatus('missing')).toBeUndefined();
    await fixture.queue.close();
  });

  it('maps provider and explicit blocked outcomes without retrying them', async () => {
    const fixture = createFixture();
    const rateLimited = vi.fn(async () => {
      throw new ProviderError(
        PROVIDER_ERRORS.RATE_LIMITED,
        'test',
        { retryAfterMs: 250 },
        'slow down'
      );
    });
    const rateJob = await fixture.queue.enqueue({
      sessionId: 'rate-session',
      execute: rateLimited,
    });
    await waitForJob(fixture.queue, rateJob, 'completed');
    expect(rateLimited).toHaveBeenCalledOnce();
    expect(fixture.dao.states.get('rate-session')).toMatchObject({
      status: 'blocked',
      agentState: {
        blockReason: 'rate_limit',
        waitingFor: 'api_retry',
        retryAfterMs: 250,
      },
    });

    const providerJob = await fixture.queue.enqueue({
      sessionId: 'provider-session',
      execute: async () => {
        throw new ProviderError(PROVIDER_ERRORS.INIT_FAILED, 'broken', undefined, 'unavailable');
      },
    });
    await waitForJob(fixture.queue, providerJob, 'completed');
    expect(fixture.dao.states.get('provider-session')).toMatchObject({
      status: 'blocked',
      agentState: { blockReason: 'api_error' },
    });

    const blockedJob = await fixture.queue.enqueue({
      sessionId: 'blocked-session',
      execute: async () => {
        throw { blockReason: 'waiting_for_user_input', waitingFor: 'user_message' };
      },
    });
    await waitForJob(fixture.queue, blockedJob, 'completed');
    expect(fixture.dao.states.get('blocked-session')).toMatchObject({
      status: 'blocked',
      agentState: {
        blockReason: 'waiting_for_user_input',
        waitingFor: 'user_message',
      },
    });
    await fixture.queue.close();
  });

  it('retries generic failures three times and records the final blocked diagnostic', async () => {
    const fixture = createFixture();
    const execute = vi.fn(async () => {
      throw new Error('transient failure');
    });
    const jobId = await fixture.queue.enqueue({ sessionId: 'retry-session', execute });
    await waitForJob(fixture.queue, jobId, 'failed');

    expect(execute).toHaveBeenCalledTimes(3);
    expect(fixture.queue.getStatus(jobId)).toMatchObject({
      status: 'failed',
      error: 'transient failure',
    });
    expect(fixture.dao.states.get('retry-session')).toMatchObject({
      status: 'blocked',
      agentState: {
        blockReason: 'job_error',
        waitingFor: 'api_retry',
        retryCount: 3,
        lastError: 'transient failure',
      },
    });
    await fixture.queue.close();
  });

  it('fails closed when persistence is unavailable and rejects forged internal block reasons', async () => {
    const execute = vi.fn(async () => {
      throw { blockReason: 'job_error', waitingFor: 'api_retry' };
    });
    const unavailableDb = {
      getSessionStateDAO: () => {
        throw new Error('database is not initialized');
      },
    } as unknown as DatabaseManager;
    const queue = new ConversationJobQueue({} as StreamPersistWorker, undefined, unavailableDb);

    const jobId = await queue.enqueue({ sessionId: 'unavailable-session', execute });
    await waitForJob(queue, jobId, 'failed');

    expect(execute).toHaveBeenCalledTimes(3);
    expect(queue.getStatus(jobId)).toMatchObject({
      status: 'failed',
      error: '[object Object]',
    });
    await queue.close();
  });

  it('cancels queued jobs and rejects new admission after shutdown or capacity exhaustion', async () => {
    let releaseScheduler = (): void => {};
    const fixture = createFixture({
      wait: () =>
        new Promise<void>((resolve) => {
          releaseScheduler = resolve;
        }),
    });
    const jobId = await fixture.queue.enqueue({
      sessionId: 'queued-session',
      messageId: 'message-queued',
      execute: async () => {},
    });
    expect(fixture.queue.getPendingJobs('queued-session')).toEqual([
      expect.objectContaining({ jobId, status: 'queued', messageId: 'message-queued' }),
    ]);
    expect(fixture.queue.cancelJob(jobId)).toBe(true);
    expect(fixture.queue.cancelJob(jobId)).toBe(false);
    expect(fixture.queue.cancelJob('missing')).toBe(false);
    expect(fixture.scheduler.cancel).toHaveBeenCalledWith(jobId);
    expect(fixture.eventHub.emitJobCancelled).toHaveBeenCalledWith('queued-session', jobId);
    releaseScheduler();
    await waitForJob(fixture.queue, jobId, 'cancelled');

    fixture.queue.stopAccepting();
    await expect(
      fixture.queue.enqueue({ sessionId: 'rejected', execute: async () => {} })
    ).rejects.toThrow('Job queue is shutting down');

    const full = createFixture();
    (full.queue as unknown as { maxQueueSize: number }).maxQueueSize = 0;
    await expect(
      full.queue.enqueue({ sessionId: 'full', execute: async () => {} })
    ).rejects.toThrow('Job queue is full');
    expect(full.admitNewRun).not.toHaveBeenCalled();
    await Promise.all([fixture.queue.close(), full.queue.close()]);
  });
});

function createFixture(options: { wait?: () => Promise<void> } = {}) {
  const states = new Map<string, SessionState>();
  const dao = {
    states,
    get: vi.fn(async (sessionId: string) => {
      const current = states.get(sessionId) ?? state(sessionId, 'idle');
      states.set(sessionId, current);
      return current;
    }),
    update: vi.fn(async (sessionId: string, update: Partial<SessionState>) => {
      const current = states.get(sessionId) ?? state(sessionId, 'idle');
      states.set(sessionId, { ...current, ...update });
    }),
  };
  const db = { getSessionStateDAO: () => dao } as unknown as DatabaseManager;
  const eventHub = {
    emitJobQueued: vi.fn(),
    emitJobStarted: vi.fn(),
    emitJobCompleted: vi.fn(),
    emitJobCancelled: vi.fn(),
    publish: vi.fn(),
  } as unknown as SessionEventHub &
    Record<
      'emitJobQueued' | 'emitJobStarted' | 'emitJobCompleted' | 'emitJobCancelled' | 'publish',
      ReturnType<typeof vi.fn>
    >;
  const scheduler = {
    enqueue: vi.fn(),
    wait: vi.fn(options.wait ?? (async () => {})),
    complete: vi.fn(),
    cancel: vi.fn(),
  } as unknown as HarnessRunScheduler &
    Record<'enqueue' | 'wait' | 'complete' | 'cancel', ReturnType<typeof vi.fn>>;
  const admitNewRun = vi.fn();
  const queue = new ConversationJobQueue(
    {} as StreamPersistWorker,
    eventHub,
    db,
    scheduler,
    admitNewRun
  );
  return { queue, dao, eventHub, scheduler, admitNewRun };
}

async function waitForJob(
  queue: ConversationJobQueue,
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled'
): Promise<void> {
  await vi.waitFor(() => expect(queue.getStatus(jobId)?.status).toBe(status));
}

function state(sessionId: string, status: SessionState['status']): SessionState {
  const now = new Date(0).toISOString();
  return {
    sessionId,
    status,
    agentState: { schema_version: 1 },
    createdAt: now,
    updatedAt: now,
    lastActiveAt: now,
    version: 1,
  };
}
