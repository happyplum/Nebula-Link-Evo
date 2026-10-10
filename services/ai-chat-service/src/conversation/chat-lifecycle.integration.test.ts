import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from '../config/schema.js';
import { ConversationDatabase } from '../db/ConversationDatabase.js';
import { HarnessProjectionStore } from '../harness/projection-store.js';
import { HarnessRunScheduler } from '../harness/run-scheduler.js';
import type { HarnessRuntime, HarnessSessionHandle } from '../harness/index.js';
import { ChatSessionController } from '../services/chat-session-controller.js';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';
import { ChatHandler } from './chat-handler.js';
import { ConversationManager } from './manager.js';
import { SessionEventHub } from './session-event-hub.js';

const databases: ConversationDatabase[] = [];
vi.mock('../services/logger.js', () => ({
  createWorkerLogger: () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.close()));
});

function fixture(
  options: {
    followup?: () => Promise<void>;
    reason?: TurnEndReason;
    historical?: SessionEvent[];
  } = {}
) {
  const db = new ConversationDatabase();
  databases.push(db);
  db.initialize(':memory:');
  const manager = new ConversationManager(':memory:', db);
  manager.createSession({ id: 'chat', title: 'chat', provider: 'test', model: 'test' });
  const controller = new ChatSessionController(db);
  const scheduler = new HarnessRunScheduler(db.connection(), 1);
  const events: SessionEvent[] = [...(options.historical ?? [])];
  let turn = 0;
  const handle = {
    followup: vi.fn(async () => {
      events.push({
        seq: events.length,
        time: Date.now(),
        type: 'turn/start',
        data: { turn },
      } as SessionEvent);
      await options.followup?.();
      events.push({
        seq: events.length,
        time: Date.now(),
        type: 'turn/end',
        data: {
          turn: turn++,
          reason: options.reason ?? { kind: 'completed' },
        },
      } as SessionEvent);
    }),
    cancel: vi.fn(),
    events: (fromSeq = 0) => events.slice(fromSeq),
    flush: vi.fn(async () => events.length),
    dispose: vi.fn(async () => {}),
  } as unknown as HarnessSessionHandle;
  const harness = {
    revision: vi.fn(async () => 'revision'),
    openSession: vi.fn(async () => handle),
    readDurable: vi.fn(async (_sessionId: string, fromSeq = 0) => ({
      durableSeq: events.length,
      events: events.slice(fromSeq),
    })),
  } as unknown as HarnessRuntime;
  const projection = new HarnessProjectionStore(db.connection(), db.getSessionEventsDAO());
  const hub = new SessionEventHub();
  hub.bindPersistence(db.getSessionEventsDAO());
  const admission = vi.fn();
  const handler = new ChatHandler(
    manager,
    { settings: { temperature: 0, maxTokens: 100 } } as ResolvedConfig,
    harness,
    projection,
    db.getSessionEventsDAO(),
    hub,
    controller,
    scheduler,
    admission
  );
  const queue = new ConversationJobQueue(controller, hub, scheduler, admission);
  return {
    db,
    controller,
    scheduler,
    handler,
    handle,
    harness,
    queue,
    admission,
    projection,
    events,
  };
}

async function enqueue(f: ReturnType<typeof fixture>) {
  const id = await f.queue.enqueue({
    sessionId: 'chat',
    execute: ({ jobId }) =>
      f.handler.handleChatSend(
        'test',
        { sessionId: 'chat', message: 'hello' },
        { runId: jobId, statusOwner: 'queue' }
      ),
  });
  await vi.waitFor(() =>
    expect(['completed', 'failed'].includes(f.queue.getStatus(id)?.status ?? '')).toBe(true)
  );
  await f.queue.close();
  return id;
}

describe('Chat lifecycle across Handler, Queue, Controller and SQLite', () => {
  it('retries once with one run ID while keeping running, then clears its diagnostic', async () => {
    const states: string[] = [];
    const ids: (string | undefined)[] = [];
    let attempts = 0;
    const f = fixture({
      followup: async () => {
        const state = await f.controller.getStatus('chat');
        states.push(state.status);
        ids.push(state.jobId);
        if (++attempts === 1) throw new Error('transient');
        expect(state.agentState).toMatchObject({ retryCount: 1, lastError: 'transient' });
      },
    });
    const id = await enqueue(f);
    expect(states).toEqual(['running', 'running']);
    expect(ids).toEqual([id, id]);
    expect(await f.controller.getStatus('chat')).toMatchObject({ status: 'completed', jobId: id });
    expect((await f.controller.getStatus('chat')).agentState).toBeUndefined();
  });

  it('only the queue writes the final exhausted diagnostic after three failed attempts', async () => {
    const f = fixture({
      followup: async () => {
        throw new Error('exhausted');
      },
    });
    const id = await enqueue(f);
    expect(f.handle.followup).toHaveBeenCalledTimes(3);
    expect(f.queue.getStatus(id)?.status).toBe('failed');
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      jobId: id,
      agentState: { blockReason: 'job_error', retryCount: 3, lastError: 'exhausted' },
    });
  });

  it.each(['cancel', 'interrupt'] as const)(
    '%s prevents retry even when the aborted turn rejects',
    async (command) => {
      const f = fixture({
        followup: async () => {
          await f.controller[command]('chat');
          throw new Error('aborted');
        },
      });
      await enqueue(f);
      expect(f.handle.followup).toHaveBeenCalledOnce();
      expect((await f.controller.getStatus('chat')).status).toBe(
        command === 'cancel' ? 'cancelled' : 'interrupted'
      );
    }
  );

  it('a replaced run neither retries nor overwrites the new lifecycle or abort handle', async () => {
    let newAbort: AbortController | undefined;
    const f = fixture({
      followup: async () => {
        await f.controller.cancel('chat');
        await f.controller.beginRun('chat', 'new-run');
        newAbort = await f.controller.createAbortController('chat', 'new-run');
        throw new Error('old callback');
      },
    });
    await enqueue(f);
    expect(f.handle.followup).toHaveBeenCalledOnce();
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'running',
      jobId: 'new-run',
    });
    await f.controller.cancel('chat');
    expect(newAbort?.signal.aborted).toBe(true);
  });

  it('persists a pause after flush and resumes with a fresh run ID to completed', async () => {
    let finish = (): void => {};
    const f = fixture({
      followup: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const initial = f.handler.handleChatSend(
      'test',
      { sessionId: 'chat', message: 'hello' },
      { runId: 'initial', statusOwner: 'chat-handler' }
    );
    await vi.waitFor(() => expect(f.handle.followup).toHaveBeenCalledOnce());
    await f.controller.pause('chat');
    finish();
    await initial;
    expect((await f.controller.getStatus('chat')).status).toBe('paused');
    expect(f.handle.flush).toHaveBeenCalledOnce();
    const resumed = f.handler.resumeSession('test', 'chat');
    await vi.waitFor(() => expect(f.handle.followup).toHaveBeenCalledTimes(2));
    expect((await f.controller.getStatus('chat')).jobId).not.toBe('initial');
    finish();
    await resumed;
    expect((await f.controller.getStatus('chat')).status).toBe('completed');
    expect(f.admission).toHaveBeenCalledTimes(2);
    await expect(f.handler.resumeSession('test', 'chat')).rejects.toThrow('Cannot resume');
  });

  it('blocks a direct resume failure and preserves the public diagnostic', async () => {
    const f = fixture({
      followup: async () => {
        throw new Error('resume failed');
      },
    });
    await f.controller.beginRun('chat', 'previous');
    f.controller.markAsPaused('chat', 'previous');
    await expect(f.handler.resumeSession('test', 'chat')).rejects.toThrow('resume failed');
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: { blockReason: 'job_error', lastError: 'resume failed' },
    });
    expect(f.handle.followup).toHaveBeenCalledOnce();
  });

  it('preserves the original execution error if releasing the Harness handle also fails', async () => {
    const original = new Error('original execution failure');
    const f = fixture({
      followup: async () => {
        throw original;
      },
    });
    vi.mocked(f.handle.dispose).mockRejectedValue(new Error('dispose failure'));
    await expect(
      f.handler.handleChatSend(
        'test',
        { sessionId: 'chat', message: 'hello' },
        { runId: 'direct', statusOwner: 'chat-handler' }
      )
    ).rejects.toBe(original);
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: { lastError: 'original execution failure' },
    });
    expect(f.handle.flush).toHaveBeenCalledBefore(f.handle.dispose);
  });

  it('a direct release failure blocks the run and still drains its execution resources', async () => {
    const f = fixture();
    vi.mocked(f.handle.dispose).mockRejectedValueOnce(new Error('dispose failure'));
    await expect(
      f.handler.handleChatSend(
        'test',
        { sessionId: 'chat', message: 'hello' },
        { runId: 'direct', statusOwner: 'chat-handler' }
      )
    ).rejects.toThrow('dispose failure');
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: { lastError: 'dispose failure' },
    });
    await f.handler.resumeSession('test', 'chat');
    expect((await f.controller.getStatus('chat')).status).toBe('completed');
  });

  it('direct resume waits for the shared scheduler capacity before opening Harness', async () => {
    const f = fixture();
    f.scheduler.enqueue({
      runId: 'other',
      ownerType: 'agent_task',
      ownerId: 'task',
      messageId: 'other',
    });
    await f.controller.beginRun('chat', 'previous');
    f.controller.markAsPaused('chat', 'previous');
    const resumed = f.handler.resumeSession('test', 'chat');
    await vi.waitFor(async () =>
      expect((await f.controller.getStatus('chat')).status).toBe('running')
    );
    expect(f.harness.openSession).not.toHaveBeenCalled();
    f.scheduler.complete('other');
    await resumed;
    expect((await f.controller.getStatus('chat')).status).toBe('completed');
  });

  it('cancelling a resume waiting for capacity releases its queued permit with no Harness side effect', async () => {
    const f = fixture();
    f.scheduler.enqueue({
      runId: 'other',
      ownerType: 'agent_task',
      ownerId: 'task',
      messageId: 'other',
    });
    await f.controller.beginRun('chat', 'previous');
    f.controller.markAsPaused('chat', 'previous');
    const resumed = f.handler.resumeSession('test', 'chat');
    const outcome = resumed.catch((error: Error) => error);
    await vi.waitFor(() =>
      expect(
        f.db
          .connection()
          .prepare("SELECT COUNT(*) AS count FROM harness_model_runs WHERE status = 'queued'")
          .get()
      ).toMatchObject({ count: 1 })
    );
    const runId = (await f.controller.getStatus('chat')).jobId;
    await f.controller.cancel('chat');
    expect(await outcome).toBeInstanceOf(Error);
    expect(f.harness.openSession).not.toHaveBeenCalled();
    expect(
      f.db
        .connection()
        .prepare('SELECT status FROM harness_model_runs WHERE run_id = ?')
        .get(runId ?? '')
    ).toMatchObject({ status: 'cancelled' });
    expect((await f.controller.getStatus('chat')).status).toBe('cancelled');
    f.scheduler.complete('other');
  });

  it('shutdown interrupts a resume waiting for capacity instead of starting it later', async () => {
    const f = fixture();
    f.scheduler.enqueue({
      runId: 'other',
      ownerType: 'agent_task',
      ownerId: 'task',
      messageId: 'other',
    });
    await f.controller.beginRun('chat', 'previous');
    f.controller.markAsPaused('chat', 'previous');
    const resumed = f.handler.resumeSession('test', 'chat').catch((error: Error) => error);
    await vi.waitFor(() =>
      expect(
        f.db
          .connection()
          .prepare("SELECT COUNT(*) AS count FROM harness_model_runs WHERE status = 'queued'")
          .get()
      ).toMatchObject({ count: 1 })
    );
    await f.handler.close();
    expect(await resumed).toBeInstanceOf(Error);
    expect(f.harness.openSession).not.toHaveBeenCalled();
    expect((await f.controller.getStatus('chat')).status).toBe('interrupted');
    f.scheduler.complete('other');
  });

  it('deletion drain releases retained pause flags even without an active Harness handle', async () => {
    const f = fixture();
    await f.controller.beginRun('chat', 'paused');
    f.controller.setPauseFlags('chat', { pauseAfterGeneration: true });
    f.controller.markAsPaused('chat', 'paused');
    await f.handler.cancelAndDrain('chat');
    expect(f.controller.shouldPause('chat', 'paused', 'afterGeneration')).toBe(false);
    expect((await f.controller.getStatus('chat')).status).toBe('cancelled');
  });

  it.each(['blocked', 'aborted', 'interrupted'] as const)(
    'settles the current durable %s terminal through the controller',
    async (kind) => {
      const f = fixture({ reason: { kind } as TurnEndReason });
      await enqueue(f);
      expect((await f.controller.getStatus('chat')).status).toBe(
        kind === 'blocked' ? 'paused' : 'interrupted'
      );
    }
  );

  it('a DSH error terminal is a failure even though followup resolves', async () => {
    const f = fixture({
      reason: {
        kind: 'error',
        error: { name: 'Error', code: 'TIMEOUT', message: 'durable failure' },
      } as TurnEndReason,
    });
    await enqueue(f);
    expect(f.handle.followup).toHaveBeenCalledTimes(3);
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: { retryCount: 3, lastError: 'durable failure' },
    });
  });

  it('a durable rate-limit terminal blocks immediately without repeating the turn', async () => {
    const f = fixture({
      reason: {
        kind: 'error',
        error: { name: 'Error', code: 'RATE_LIMITED', message: 'slow down' },
      } as TurnEndReason,
    });
    await enqueue(f);
    expect(f.handle.followup).toHaveBeenCalledOnce();
    expect(await f.controller.getStatus('chat')).toMatchObject({
      status: 'blocked',
      agentState: { blockReason: 'rate_limit', waitingFor: 'api_retry', lastError: 'slow down' },
    });
  });

  it('historical error catch-up cannot settle the fresh run', async () => {
    const historical = [
      {
        seq: 0,
        time: 1,
        type: 'turn/end',
        data: {
          turn: 99,
          reason: { kind: 'error', error: { name: 'Error', message: 'old failure' } },
        },
      },
    ] as SessionEvent[];
    const f = fixture({ historical });
    await f.controller.beginRun('chat', 'current');
    const before = await f.controller.getStatus('chat');
    await f.handler.catchUpDurable('chat');
    expect(await f.controller.getStatus('chat')).toEqual(before);
    await f.handler.handleChatSend(
      'test',
      { sessionId: 'chat', message: 'hello' },
      { runId: 'current', statusOwner: 'queue' }
    );
    f.controller.complete('chat', 'current');
    expect((await f.controller.getStatus('chat')).status).toBe('completed');
  });
});
