import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationDatabase } from '../db/ConversationDatabase.js';
import { ChatSessionController } from './chat-session-controller.js';
import type { SessionEventHub } from '../conversation/session-event-hub.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';
import { ConversationJobQueue } from './conversation-job-queue.js';
import { ProviderError, PROVIDER_ERRORS } from './provider/errors.js';

vi.mock('./logger.js', () => ({
  createWorkerLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}));

const databases: ConversationDatabase[] = [];
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

describe('ConversationJobQueue', () => {
  it('runs jobs through the scheduler and never overwrites a durable paused state', async () => {
    const fixture = createFixture();
    const pausedJob = await fixture.queue.enqueue({
      sessionId: 'paused-session',
      messageId: 'message-1',
      contentPreview: 'pause',
      idempotencyKey: 'idem-1',
      execute: async (context) => {
        fixture.controller.markAsPaused('paused-session', context.jobId);
      },
    });
    await waitForJob(fixture.queue, pausedJob, 'completed');

    expect(await fixture.dao.get('paused-session')).toMatchObject({
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
    expect(await fixture.dao.get('normal-session')).toMatchObject({
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
    expect(await fixture.dao.get('rate-session')).toMatchObject({
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
    expect(await fixture.dao.get('provider-session')).toMatchObject({
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
    expect(await fixture.dao.get('blocked-session')).toMatchObject({
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
    expect(await fixture.dao.get('retry-session')).toMatchObject({
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

  it('fails closed before execution when persistence is unavailable', async () => {
    const execute = vi.fn(async () => {
      throw { blockReason: 'job_error', waitingFor: 'api_retry' };
    });
    const unavailableDb = new ConversationDatabase();
    const queue = new ConversationJobQueue(
      new ChatSessionController(unavailableDb),
      undefined,
      {
        enqueue: vi.fn(),
        wait: vi.fn(async () => {}),
        complete: vi.fn(),
      } as unknown as HarnessRunScheduler,
      vi.fn()
    );

    const jobId = await queue.enqueue({ sessionId: 'unavailable-session', execute });
    await waitForJob(queue, jobId, 'failed');

    expect(execute).not.toHaveBeenCalled();
    expect(queue.getStatus(jobId)).toMatchObject({
      status: 'failed',
      error: 'Conversation database not initialized',
    });
    await queue.close();
  });

  it('does not trust an internal job_error as an explicit no-retry blocked outcome', async () => {
    const f = createFixture();
    const execute = vi.fn(async () => {
      throw { blockReason: 'job_error', waitingFor: 'api_retry' };
    });
    const id = await f.queue.enqueue({ sessionId: 'retry-session', execute });
    await waitForJob(f.queue, id, 'failed');
    expect(execute).toHaveBeenCalledTimes(3);
    expect((await f.controller.getStatus('retry-session')).agentState).toMatchObject({
      blockReason: 'job_error',
      retryCount: 3,
      lastError: '[object Object]',
    });
    await f.queue.close();
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

  it('does not replay a cancelled running job and cleans up settled jobs after retention', async () => {
    const f = createFixture();
    let settle = (): void => {};
    const execute = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    const id = await f.queue.enqueue({ sessionId: 'normal-session', execute });
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce());
    expect(f.queue.cancelJob(id)).toBe(false);
    await f.controller.cancel('normal-session');
    f.queue.cancel(id);
    f.queue.cancel(id);
    f.queue.cancel('missing');
    settle();
    await f.queue.close();
    expect(f.queue.getStatus(id)?.status).toBe('cancelled');
    expect((await f.controller.getStatus('normal-session')).status).toBe('cancelled');
    expect(execute).toHaveBeenCalledOnce();
    expect(f.queue.cancelJob(id)).toBe(false);
    const before = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(before + 11 * 60 * 1000);
    try {
      f.queue.cleanup();
      expect(f.queue.getStatus(id)).toBeUndefined();
      expect(f.queue.getPendingJobs('normal-session')).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('keeps cancelled status when a queued scheduler wait is rejected', async () => {
    let rejectWait = (_error: Error): void => {};
    const f = createFixture({
      wait: () =>
        new Promise<void>((_resolve, reject) => {
          rejectWait = reject;
        }),
    });
    const execute = vi.fn(async () => {});
    const id = await f.queue.enqueue({ sessionId: 'normal-session', execute });
    await vi.waitFor(() => expect(f.scheduler.wait).toHaveBeenCalledOnce());
    f.queue.cancel(id);
    rejectWait(new Error('cancelled wait'));
    await f.queue.close();
    expect(f.queue.getStatus(id)?.status).toBe('cancelled');
    expect(execute).not.toHaveBeenCalled();
  });
});

function createFixture(options: { wait?: () => Promise<void> } = {}) {
  const db = new ConversationDatabase();
  databases.push(db);
  db.initialize(':memory:');
  for (const id of [
    'paused-session',
    'normal-session',
    'rate-session',
    'provider-session',
    'blocked-session',
    'retry-session',
    'queued-session',
    'rejected',
    'full',
  ]) {
    db.createSession({ id, title: id, provider: 'test', model: 'test' });
  }
  const dao = db.getSessionStateDAO();
  const controller = new ChatSessionController(db);
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
  const queue = new ConversationJobQueue(controller, eventHub, scheduler, admitNewRun);
  return { queue, dao, db, controller, eventHub, scheduler, admitNewRun };
}

async function waitForJob(
  queue: ConversationJobQueue,
  jobId: string,
  status: 'completed' | 'failed' | 'cancelled'
): Promise<void> {
  await vi.waitFor(() => expect(queue.getStatus(jobId)?.status).toBe(status));
}
