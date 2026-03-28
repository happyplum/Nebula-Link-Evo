import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConversationManager } from '../../../conversation/manager.js';
import { ConversationJobQueue } from '../../../services/conversation-job-queue.js';
import { SessionLock } from '../../../services/session-lock.js';
import { StreamPersistWorker } from '../../../services/stream-persist-worker.js';

type EnqueueResult = {
  status: 202 | 409;
  runId: string;
  jobId?: string;
  messageId?: string;
};

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

async function drainMicrotasks(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

describe('chat session concurrency contract (service integration)', () => {
  let manager: ConversationManager;
  let queue: ConversationJobQueue;
  let persistWorker: StreamPersistWorker;
  let sessionLock: SessionLock;

  const enqueueSessionRun = async (
    sessionId: string,
    execute: () => Promise<void>,
    content = 'test message'
  ): Promise<EnqueueResult> => {
    const runId = randomUUID();
    const acquired = sessionLock.acquire(sessionId, runId);
    if (!acquired) {
      return { status: 409, runId };
    }

    const message = manager.addMessage(sessionId, {
      role: 'user',
      content,
    });

    try {
      const jobId = await queue.enqueue({
        sessionId,
        execute: async () => {
          try {
            await execute();
          } finally {
            sessionLock.release(sessionId, runId);
          }
        },
      });

      return {
        status: 202,
        runId,
        jobId,
        messageId: message.id,
      };
    } catch (error) {
      sessionLock.release(sessionId, runId);
      throw error;
    }
  };

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
    persistWorker = new StreamPersistWorker();
    queue = new ConversationJobQueue(persistWorker);
    sessionLock = SessionLock.getInstance();
    sessionLock.clear();
  });

  afterEach(async () => {
    sessionLock.clear();
    await persistWorker.shutdown();
    await manager.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enforces same-session serial execution: second in-flight request gets 409 conflict', async () => {
    const session = manager.createSession({
      title: 'serial-session',
      provider: 'test',
      model: 'test-model',
    });

    const firstRun = createDeferred();
    const first = await enqueueSessionRun(session.id, () => firstRun.promise, 'first');
    const second = await enqueueSessionRun(session.id, async () => {}, 'second');

    expect(first.status).toBe(202);
    expect(first.jobId).toBeDefined();
    expect(second.status).toBe(409);
    expect(second.jobId).toBeUndefined();

    firstRun.resolve();
    await drainMicrotasks();
  });

  it('allows cross-session parallel execution without blocking', async () => {
    const sessionA = manager.createSession({
      title: 'parallel-a',
      provider: 'test',
      model: 'test-model',
    });
    const sessionB = manager.createSession({
      title: 'parallel-b',
      provider: 'test',
      model: 'test-model',
    });

    const deferredA = createDeferred();
    const deferredB = createDeferred();

    const runA = await enqueueSessionRun(sessionA.id, () => deferredA.promise, 'A');
    const runB = await enqueueSessionRun(sessionB.id, () => deferredB.promise, 'B');
    await drainMicrotasks();

    expect(runA.status).toBe(202);
    expect(runB.status).toBe(202);
    expect(queue.getStatus(runA.jobId!)?.status).toBe('running');
    expect(queue.getStatus(runB.jobId!)?.status).toBe('running');
    expect(sessionLock.isLocked(sessionA.id)).toBe(true);
    expect(sessionLock.isLocked(sessionB.id)).toBe(true);

    deferredA.resolve();
    deferredB.resolve();
    await drainMicrotasks();
  });

  it('completes lock acquisition and release cycle, allowing next run after release', async () => {
    const session = manager.createSession({
      title: 'release-cycle',
      provider: 'test',
      model: 'test-model',
    });

    const deferred = createDeferred();
    const first = await enqueueSessionRun(session.id, () => deferred.promise, 'hold-lock');
    expect(first.status).toBe(202);
    expect(sessionLock.isLocked(session.id)).toBe(true);

    deferred.resolve();
    await drainMicrotasks();
    expect(sessionLock.isLocked(session.id)).toBe(false);

    const next = await enqueueSessionRun(session.id, async () => {}, 'after-release');
    await drainMicrotasks();

    expect(next.status).toBe(202);
    expect(next.jobId).toBeDefined();
  });

  it('auto-releases lock by TTL expiry and accepts a new run afterwards', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');

    const session = manager.createSession({
      title: 'ttl-expiry',
      provider: 'test',
      model: 'test-model',
    });

    const staleRunId = randomUUID();
    expect(sessionLock.acquire(session.id, staleRunId)).toBe(true);
    expect(sessionLock.isLocked(session.id)).toBe(true);

    const renewalIntervalId = setIntervalSpy.mock.results[0]?.value as NodeJS.Timeout;
    clearInterval(renewalIntervalId);

    vi.advanceTimersByTime(31_000);
    vi.runOnlyPendingTimers();

    expect(sessionLock.isLocked(session.id)).toBe(false);

    const next = await enqueueSessionRun(session.id, async () => {}, 'after-ttl');
    expect(next.status).toBe(202);
  });
});
