import {
  AGENT_STREAM_EVENT_SCHEMA,
  AGENT_STREAM_SNAPSHOT_SCHEMA,
  type AgentStreamEventV1,
  type AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityContext,
  AgentActivityRepository,
} from '../../database/repositories/agent-activity-repository.js';
import {
  AgentTaskClient,
  type AgentTaskActivitySource,
  type AgentTaskActivityStreamHandlers,
} from '../../infrastructure/agent-task-client.js';
import { AgentActivityIngester } from '../agent-activity-ingester.js';

const RUN_CONTEXT: ActivityContext = { type: 'run', id: 'run-1' };

describe('AgentActivityIngester', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('catches up before subscribing, closes the snapshot gap, and ignores duplicate source seqs', async () => {
    const taskId = 'agent-task-1';
    const firstEvent = activityEvent(taskId, 1);
    const snapshotGapEvent = activityEvent(taskId, 2);
    const liveEvent = activityEvent(taskId, 3);
    const source = new FakeAgentTaskActivitySource();
    source.history.set(taskId, [firstEvent]);
    source.plans.set(taskId, [
      {
        snapshot: activitySnapshot(taskId, 2),
        beforeSnapshot: () => source.history.get(taskId)?.push(snapshotGapEvent),
        events: [snapshotGapEvent, liveEvent],
      },
    ]);
    const repository = new MemoryActivityRepository();
    const ingester = new AgentActivityIngester(source, repository);
    const links = { pageTaskId: 'page-task-1', todoId: 'todo-1' };

    ingester.start(taskId, RUN_CONTEXT, links);
    ingester.start(taskId, RUN_CONTEXT, links);

    await vi.waitFor(() => expect(repository.rows).toHaveLength(3));
    expect(repository.rows.map((row) => row.sourceSeq)).toEqual([1, 2, 3]);
    expect(repository.rows.every((row) => row.context === RUN_CONTEXT)).toBe(true);
    expect(repository.rows.every((row) => row.links === links)).toBe(true);
    expect(source.listCalls.map((call) => call.afterSeq)).toEqual([0, 1]);
    expect(source.connectionTaskIds).toEqual([taskId]);

    ingester.stop();
    await ingester.onceIdle();
  });

  it('re-reads the persisted activity log before reconnecting after a dropped stream', async () => {
    const taskId = 'agent-task-reconnect';
    const source = new FakeAgentTaskActivitySource();
    source.history.set(taskId, []);
    source.plans.set(taskId, [
      { snapshot: activitySnapshot(taskId, 0), closeAfterEvents: true },
      { snapshot: activitySnapshot(taskId, 1) },
    ]);
    const repository = new MemoryActivityRepository();
    const retryGate = deferred<void>();
    const retryWait = vi.fn(async (_milliseconds: number, signal: AbortSignal) => {
      await Promise.race([
        retryGate.promise,
        new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true })),
      ]);
    });
    const ingester = new AgentActivityIngester(source, repository, { wait: retryWait });

    ingester.start(taskId, RUN_CONTEXT);
    await vi.waitFor(() => expect(retryWait).toHaveBeenCalledWith(1_000, expect.any(AbortSignal)));
    source.history.get(taskId)?.push(activityEvent(taskId, 1));
    retryGate.resolve();

    await vi.waitFor(() => expect(source.connectionTaskIds).toHaveLength(2));
    await vi.waitFor(() => expect(repository.rows).toHaveLength(1));
    expect(source.listCalls.map((call) => call.afterSeq)).toEqual([0, 0, 0, 1]);
    expect(repository.rows[0]?.sourceSeq).toBe(1);
    expect(retryWait).toHaveBeenCalledTimes(1);

    ingester.stop();
    await ingester.onceIdle();
  });

  it('caps reconnect backoff at thirty seconds', async () => {
    const taskId = 'agent-task-backoff';
    const source = new FakeAgentTaskActivitySource();
    source.history.set(taskId, []);
    source.plans.set(
      taskId,
      Array.from({ length: 8 }, () => ({
        snapshot: activitySnapshot(taskId, 0),
        closeAfterEvents: true,
      }))
    );
    const retryDelays: number[] = [];
    let ingester: AgentActivityIngester;
    ingester = new AgentActivityIngester(source, new MemoryActivityRepository(), {
      wait: async (milliseconds) => {
        retryDelays.push(milliseconds);
        if (retryDelays.length === 8) ingester.stop();
      },
    });

    ingester.start(taskId, RUN_CONTEXT);
    await ingester.onceIdle();

    expect(retryDelays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('drains an already-terminal task from activity-log without opening a stream', async () => {
    const taskId = 'agent-task-terminal';
    const terminalEvent: AgentStreamEventV1 = {
      schema: AGENT_STREAM_EVENT_SCHEMA,
      streamId: taskId,
      turnId: `task:${taskId}`,
      sectionId: `task:${taskId}:state`,
      seq: 1,
      occurredAt: '2026-01-01T00:00:00.000Z',
      type: 'stream.state',
      state: 'completed',
    };
    const source = new FakeAgentTaskActivitySource();
    source.history.set(taskId, [terminalEvent]);
    const repository = new MemoryActivityRepository();
    const ingester = new AgentActivityIngester(source, repository);

    ingester.start(taskId, RUN_CONTEXT);
    ingester.stop(taskId, RUN_CONTEXT);
    await ingester.onceIdle();

    expect(repository.rows.map((row) => row.sourceSeq)).toEqual([1]);
    expect(source.connectionTaskIds).toEqual([]);
    expect(source.listCalls.map((call) => call.afterSeq)).toEqual([0]);
  });

  it('keeps the same source task isolated by each business context cursor', async () => {
    const taskId = 'agent-task-shared-fixture';
    const source = new FakeAgentTaskActivitySource();
    source.history.set(taskId, [activityEvent(taskId, 1)]);
    source.plans.set(taskId, [
      { snapshot: activitySnapshot(taskId, 1) },
      { snapshot: activitySnapshot(taskId, 1) },
    ]);
    const repository = new MemoryActivityRepository();
    const ingester = new AgentActivityIngester(source, repository);
    const authoringContext: ActivityContext = { type: 'authoring', id: 'job-1' };

    ingester.start(taskId, RUN_CONTEXT);
    ingester.start(taskId, authoringContext);
    await vi.waitFor(() => expect(repository.rows).toHaveLength(2));

    expect(repository.rows.map((row) => row.context)).toEqual([RUN_CONTEXT, authoringContext]);
    expect(source.listCalls.map((call) => call.afterSeq)).toEqual([0, 0, 1, 1]);

    ingester.stop();
    await ingester.onceIdle();
  });
});

describe('AgentTaskClient Agent activity SSE', () => {
  it('parses snapshot-first frames split across fetch chunks', async () => {
    const taskId = 'task/with space';
    const snapshot = activitySnapshot(taskId, 0);
    const event = activityEvent(taskId, 1);
    const payload = [
      `event: agent_stream.snapshot\nid: 0\ndata: ${JSON.stringify(snapshot)}\n\n`,
      `event: agent_stream.event\nid: 1\ndata: ${JSON.stringify(event)}\n\n`,
    ].join('');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(payload);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 31));
        controller.enqueue(bytes.slice(31));
        controller.close();
      },
    });
    const fetchMock = vi.fn(async () =>
      new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new AgentTaskClient({ baseUrl: 'http://chat.example' });
    const receivedSnapshots: AgentStreamSnapshotV1[] = [];
    const receivedEvents: AgentStreamEventV1[] = [];
    const handlers: AgentTaskActivityStreamHandlers = {
      onSnapshot: (value) => receivedSnapshots.push(value),
      onEvent: (value) => receivedEvents.push(value),
    };

    await client.streamTaskActivity(taskId, new AbortController().signal, handlers);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://chat.example/api/v1/agent-tasks/task%2Fwith%20space/activity',
      expect.objectContaining({
        headers: expect.objectContaining({ Accept: 'text/event-stream' }),
      })
    );
    expect(receivedSnapshots).toEqual([snapshot]);
    expect(receivedEvents).toEqual([event]);
  });
});

class FakeAgentTaskActivitySource implements AgentTaskActivitySource {
  readonly history = new Map<string, AgentStreamEventV1[]>();
  readonly plans = new Map<string, ConnectionPlan[]>();
  readonly listCalls: Array<{ taskId: string; afterSeq: number; limit: number }> = [];
  readonly connectionTaskIds: string[] = [];

  async listTaskActivity(
    taskId: string,
    afterSeq = 0,
    limit = 500,
    signal?: AbortSignal
  ): Promise<AgentStreamEventV1[]> {
    if (signal?.aborted) return [];
    this.listCalls.push({ taskId, afterSeq, limit });
    return (this.history.get(taskId) ?? [])
      .filter((event) => event.seq > afterSeq)
      .slice(0, limit);
  }

  async streamTaskActivity(
    taskId: string,
    signal: AbortSignal,
    handlers: AgentTaskActivityStreamHandlers
  ): Promise<void> {
    this.connectionTaskIds.push(taskId);
    const plan = this.plans.get(taskId)?.shift();
    if (!plan) throw new Error(`No stream plan for ${taskId}`);
    plan.beforeSnapshot?.();
    await handlers.onSnapshot(plan.snapshot);
    if (signal.aborted) return;
    for (const event of plan.events ?? []) {
      handlers.onEvent(event);
      if (signal.aborted) return;
    }
    if (plan.closeAfterEvents) return;
    await waitForAbort(signal);
  }
}

interface ConnectionPlan {
  snapshot: AgentStreamSnapshotV1;
  beforeSnapshot?: () => void;
  events?: AgentStreamEventV1[];
  closeAfterEvents?: boolean;
}

class MemoryActivityRepository implements Pick<AgentActivityRepository, 'cursor' | 'append'> {
  readonly rows: Array<{
    context: ActivityContext;
    sourceTaskId: string;
    sourceSeq: number;
    links: Parameters<AgentActivityRepository['append']>[3];
  }> = [];

  cursor(context: ActivityContext, sourceTaskId: string): number {
    return this.rows
      .filter(
        (row) =>
          row.context.type === context.type &&
          row.context.id === context.id &&
          row.sourceTaskId === sourceTaskId
      )
      .reduce((maxSeq, row) => Math.max(maxSeq, row.sourceSeq), 0);
  }

  append(
    context: ActivityContext,
    sourceTaskId: string,
    event: AgentStreamEventV1,
    links: Parameters<AgentActivityRepository['append']>[3] = {}
  ): AgentStreamEventV1 | null {
    const duplicate = this.rows.some(
      (row) =>
        row.context.type === context.type &&
        row.context.id === context.id &&
        row.sourceTaskId === sourceTaskId &&
        row.sourceSeq === event.seq
    );
    if (duplicate) return null;
    this.rows.push({ context, sourceTaskId, sourceSeq: event.seq, links });
    return event;
  }
}

function activityEvent(taskId: string, seq: number): AgentStreamEventV1 {
  return {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId: taskId,
    turnId: `task:${taskId}`,
    sectionId: `task:${taskId}:activity`,
    seq,
    occurredAt: '2026-01-01T00:00:00.000Z',
    type: 'section.upsert',
    section: {
      type: 'activity',
      sectionId: `task:${taskId}:activity`,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      kind: 'agent',
      state: 'running',
      title: `Activity ${seq}`,
    },
  };
}

function activitySnapshot(
  taskId: string,
  seq: number,
  state: AgentStreamSnapshotV1['state'] = 'streaming'
): AgentStreamSnapshotV1 {
  return {
    schema: AGENT_STREAM_SNAPSHOT_SCHEMA,
    streamId: taskId,
    seq,
    state,
    generatedAt: '2026-01-01T00:00:00.000Z',
    turns: [],
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
}
