import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationJobQueue } from '../../../services/conversation-job-queue.js';
import { SessionLock } from '../../../services/session-lock.js';
import { StreamPersistWorker } from '../../../services/stream-persist-worker.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function drainMicrotasks(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await Promise.resolve();
  }
}

async function waitForJobTerminalStatuses(
  queue: ConversationJobQueue,
  jobIds: string[],
  timeoutMs = 2_000
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const allTerminal = jobIds.every((jobId) => {
      const status = queue.getStatus(jobId)?.status;
      return status === 'completed' || status === 'failed' || status === 'cancelled';
    });

    if (allTerminal) {
      return;
    }

    await sleep(5);
  }

  throw new Error(`Timed out waiting for terminal statuses: ${jobIds.join(', ')}`);
}

describe('session isolation under load contract', () => {
  let sessionLock: SessionLock;
  let persistWorker: StreamPersistWorker;
  let queue: ConversationJobQueue;

  beforeEach(() => {
    sessionLock = SessionLock.getInstance();
    sessionLock.clear();
    persistWorker = new StreamPersistWorker();
    queue = new ConversationJobQueue(persistWorker);
  });

  afterEach(async () => {
    sessionLock.clear();
    await persistWorker.shutdown();
  });

  it('keeps same-session active run <= 1 with 10+ concurrent sessions and concurrent contenders', async () => {
    const sessionCount = 12;
    const contendersPerSession = 4;
    const activeRuns = new Map<string, number>();
    const maxConcurrentRuns = new Map<string, number>();
    const completedBySession = new Map<string, number>();

    const tasks: Array<Promise<void>> = [];

    for (let i = 0; i < sessionCount; i++) {
      const sessionId = `load-session-${i}`;

      for (let contender = 0; contender < contendersPerSession; contender++) {
        const contenderTask = (async () => {
          const runId = `${sessionId}-run-${contender}-${randomUUID()}`;
          let acquired = false;
          let attempts = 0;

          while (!acquired) {
            acquired = sessionLock.acquire(sessionId, runId);
            if (!acquired) {
              attempts++;
              if (attempts > 200) {
                throw new Error(`Failed to acquire lock after retries for ${sessionId}`);
              }
              await sleep(1);
            }
          }

          const nextActive = (activeRuns.get(sessionId) ?? 0) + 1;
          activeRuns.set(sessionId, nextActive);
          maxConcurrentRuns.set(sessionId, Math.max(maxConcurrentRuns.get(sessionId) ?? 0, nextActive));

          await sleep(2);

          activeRuns.set(sessionId, nextActive - 1);
          completedBySession.set(sessionId, (completedBySession.get(sessionId) ?? 0) + 1);
          sessionLock.release(sessionId, runId);
        })();

        tasks.push(contenderTask);
      }
    }

    await Promise.all(tasks);

    expect(sessionLock.getActiveLockCount()).toBe(0);
    for (let i = 0; i < sessionCount; i++) {
      const sessionId = `load-session-${i}`;
      expect(maxConcurrentRuns.get(sessionId)).toBe(1);
      expect(completedBySession.get(sessionId)).toBe(contendersPerSession);
      expect(activeRuns.get(sessionId) ?? 0).toBe(0);
      expect(sessionLock.isLocked(sessionId)).toBe(false);
    }
  });

  it('serializes same-session queue jobs and runs cross-session jobs in parallel', async () => {
    const sameSessionId = 'queue-same-session';
    let sameSessionActive = 0;
    let sameSessionMaxActive = 0;

    const sameSessionJobIds = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        queue.enqueue({
          sessionId: sameSessionId,
          execute: async () => {
            sameSessionActive++;
            sameSessionMaxActive = Math.max(sameSessionMaxActive, sameSessionActive);
            await sleep(index === 0 ? 20 : 5);
            sameSessionActive--;
          },
        })
      )
    );

    await waitForJobTerminalStatuses(queue, sameSessionJobIds);
    expect(sameSessionMaxActive).toBe(1);
    expect(sameSessionJobIds.every((id) => queue.getStatus(id)?.status === 'completed')).toBe(true);

    let sessionAStarted = false;
    let sessionBStarted = false;
    let releaseParallelJobs: (() => void) | null = null;
    const parallelBarrier = new Promise<void>((resolve) => {
      releaseParallelJobs = resolve;
    });

    const jobA = await queue.enqueue({
      sessionId: 'parallel-session-a',
      execute: async () => {
        sessionAStarted = true;
        await parallelBarrier;
      },
    });

    const jobB = await queue.enqueue({
      sessionId: 'parallel-session-b',
      execute: async () => {
        sessionBStarted = true;
        await parallelBarrier;
      },
    });

    await drainMicrotasks();
    expect(sessionAStarted).toBe(true);
    expect(sessionBStarted).toBe(true);
    expect(queue.getStatus(jobA)?.status).toBe('running');
    expect(queue.getStatus(jobB)?.status).toBe('running');

    releaseParallelJobs?.();
    await waitForJobTerminalStatuses(queue, [jobA, jobB]);
  });

  it('does not leak same-session queue lock when a job fails', async () => {
    const sessionId = 'queue-failure-recovery';
    const failedJobId = await queue.enqueue({
      sessionId,
      execute: async () => {
        throw new Error('expected failure');
      },
    });

    await waitForJobTerminalStatuses(queue, [failedJobId]);
    expect(queue.getStatus(failedJobId)?.status).toBe('failed');

    let recoveryExecuted = false;
    const recoveryJobId = await queue.enqueue({
      sessionId,
      execute: async () => {
        recoveryExecuted = true;
      },
    });

    await waitForJobTerminalStatuses(queue, [recoveryJobId]);
    expect(recoveryExecuted).toBe(true);
    expect(queue.getStatus(recoveryJobId)?.status).toBe('completed');
  });
});
