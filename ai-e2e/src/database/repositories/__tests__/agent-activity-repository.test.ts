import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AuthoringSnapshotV1,
  SemanticEventV1,
} from '../../../contracts/semantic-control.js';
import { up as migrateAgentActivity } from '../../migrations/020-agent-activity.js';
import { BusinessVersionRepository } from '../business-version-repository.js';
import { AgentActivityRepository } from '../agent-activity-repository.js';
import { publishPersistedSemanticControlEvent } from '../semantic-control-event-utils.js';
import { inImmediateTransaction } from '../semantic-repository-utils.js';
import { SemanticQueryRepository } from '../semantic-query-repository.js';
import { SemanticQueryService } from '../../../services/semantic-query-service.js';
import { SemanticControlEventHub } from '../../../services/semantic-control-event-hub.js';
import errorHandlerPlugin from '../../../server/plugins/error-handler.js';
import agentActivityRoutes from '../../../server/routes/agent-activity.js';
import semanticControlRoutes from '../../../server/routes/semantic-control.js';

const occurredAt = '2026-08-27T08:00:00.000Z';
const databases: Database.Database[] = [];
const apps: Array<ReturnType<typeof Fastify>> = [];

function setupDatabase() {
  const db = new Database(':memory:');
  databases.push(db);
  db.exec(`
    CREATE TABLE preserved_rows (id TEXT PRIMARY KEY);
    INSERT INTO preserved_rows(id) VALUES ('keep-me');
    CREATE TABLE authoring_jobs (id TEXT PRIMARY KEY);
    CREATE TABLE test_runs (id TEXT PRIMARY KEY);
    CREATE TABLE authoring_context_threads (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL
    );
    CREATE TABLE authoring_chat_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE authoring_events (
      id TEXT,
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      state_version INTEGER,
      correlation_id TEXT,
      causation_id TEXT,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE run_events (
      id TEXT,
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      state_version INTEGER,
      correlation_id TEXT,
      causation_id TEXT,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    INSERT INTO authoring_jobs(id) VALUES ('job-1'), ('job-2');
    INSERT INTO test_runs(id) VALUES ('run-1');
    INSERT INTO authoring_context_threads(id, job_id) VALUES ('thread-1', 'job-1');
  `);
  migrateAgentActivity(db);
  return { db, repository: new AgentActivityRepository(db) };
}

function activityEvent(
  streamId: string,
  seq: number,
  state: 'running' | 'completed' | 'outcome_unknown' | 'queued' | 'blocked' | 'failed' = 'running'
): AgentStreamEventV1 {
  return {
    schema: AGENT_STREAM_EVENT_SCHEMA,
    streamId,
    turnId: `task:${streamId}`,
    sectionId: `task:${streamId}:agent`,
    seq,
    occurredAt,
    type: 'section.upsert',
    section: {
      type: 'activity',
      sectionId: `task:${streamId}:agent`,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      kind: 'agent',
      state,
      title: `Agent ${streamId}`,
    },
  };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const app of apps.splice(0)) await app.close();
  for (const db of databases.splice(0)) db.close();
});

describe('AgentActivityRepository', () => {
  it('以 additive migration 保留数据，并为多 Agent 分配独立 cursor 与本地单调 seq', () => {
    const { db, repository } = setupDatabase();
    const context = { type: 'authoring' as const, id: 'job-1' };

    const first = repository.append(context, 'external-a', activityEvent('external-a', 4));
    const duplicate = repository.append(context, 'external-a', activityEvent('external-a', 4));
    const second = repository.append(
      context,
      'external-b',
      activityEvent('external-b', 8, 'completed')
    );

    expect(db.prepare('SELECT id FROM preserved_rows').all()).toEqual([{ id: 'keep-me' }]);
    expect(first?.seq).toBe(1);
    expect(duplicate).toBeNull();
    expect(second?.seq).toBe(2);
    expect(repository.cursor(context, 'external-a')).toBe(4);
    expect(repository.cursor(context, 'external-b')).toBe(8);
    expect(repository.list(context).map((event) => event.streamId)).toEqual(['job-1', 'job-1']);
    expect(repository.list({ type: 'run', id: 'run-1' })).toEqual([]);
  });

  it('从持久事件恢复运行、阻塞与结果未知语义', () => {
    const { repository } = setupDatabase();
    const context = { type: 'run' as const, id: 'run-1' };
    repository.append(context, 'external-a', activityEvent('external-a', 4, 'completed'));
    repository.append(context, 'external-b', activityEvent('external-b', 8, 'outcome_unknown'));

    const snapshot = repository.snapshot(context);
    expect(snapshot).toMatchObject({
      streamId: 'run-1',
      seq: 2,
      state: 'recovering',
    });
    expect(snapshot.turns).toHaveLength(2);
  });

  it.each([
    ['running', 'streaming'],
    ['queued', 'streaming'],
    ['blocked', 'paused'],
    ['outcome_unknown', 'recovering'],
    ['failed', 'failed'],
    ['completed', 'completed'],
  ] as const)('聚合 %s activity 状态而不被外部 stream.state 覆盖', (activityState, state) => {
    const { repository } = setupDatabase();
    const context = { type: 'run' as const, id: 'run-1' };
    const activity = activityEvent('external-a', 4, activityState);
    repository.append(context, 'external-a', activity);
    repository.append(context, 'external-a', {
      ...activity,
      seq: 5,
      type: 'stream.state',
      state: 'cancelled',
    });
    expect(repository.snapshot(context)).toMatchObject({ state, seq: 2, generatedAt: occurredAt });
  });

  it('重放本地序列中的替换、delta、删除及终态，保留不重复 source seq', () => {
    const { repository } = setupDatabase();
    const context = { type: 'run' as const, id: 'run-1' };
    const activity = activityEvent('external-a', 4);
    const sourceEvents: AgentStreamEventV1[] = [
      activity,
      { ...activity, seq: 6, type: 'content.delta', delta: 'first' },
      { ...activity, seq: 7, type: 'content.delta', delta: ' next' },
      {
        ...activity,
        seq: 8,
        type: 'section.upsert',
        sectionId: 'remove-me',
        section: {
          type: 'notice',
          sectionId: 'remove-me',
          createdAt: occurredAt,
          updatedAt: occurredAt,
          tone: 'info',
          title: 'remove',
        },
      },
      { ...activity, seq: 9, type: 'section.remove', sectionId: 'remove-me' },
      { ...activity, seq: 10, type: 'turn.completed', state: 'completed' },
    ];
    for (const source of sourceEvents) repository.append(context, 'external-a', source);
    expect(repository.append(context, 'external-a', sourceEvents[1])).toBeNull();
    const snapshot = repository.snapshot(context);
    expect(snapshot).toMatchObject({ state: 'completed', seq: 6, generatedAt: occurredAt });
    expect(snapshot.turns).toEqual([
      {
        turnId: activity.turnId,
        role: 'assistant',
        state: 'completed',
        createdAt: occurredAt,
        updatedAt: occurredAt,
        sections: [
          {
            type: 'content',
            sectionId: activity.sectionId,
            createdAt: occurredAt,
            updatedAt: occurredAt,
            markdown: 'first next',
            streaming: true,
          },
        ],
      },
    ]);
  });

  it('空业务上下文仍使用当前时间和 idle 状态', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z'));
    const { repository } = setupDatabase();
    expect(repository.snapshot({ type: 'run', id: 'run-1' })).toMatchObject({
      state: 'idle',
      seq: 0,
      turns: [],
      generatedAt: '2026-10-03T00:00:00.000Z',
    });
  });

  it('把审批、验证、激活与 TODO 控制面事实投影到同一持久活动流', () => {
    const { db, repository } = setupDatabase();
    db.prepare(
      `INSERT INTO authoring_events
       (job_id, seq, type, entity_type, entity_id, payload_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('job-1', 1, 'decision.requested', 'decision', 'decision-1', '{}', occurredAt);
    db.prepare(
      `INSERT INTO authoring_events
       (job_id, seq, type, entity_type, entity_id, payload_json, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'job-1',
      2,
      'asset.candidate_activated',
      'authoring_amendment',
      'amendment-1',
      '{}',
      occurredAt
    );

    const events = repository.list({ type: 'authoring', id: 'job-1' });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: expect.objectContaining({ type: 'decision', state: 'waiting' }),
        }),
        expect.objectContaining({
          section: expect.objectContaining({ type: 'notice', tone: 'success' }),
        }),
      ])
    );
    expect(
      repository.cursor({ type: 'authoring', id: 'job-1' }, 'semantic-control:authoring')
    ).toBe(2);
  });

  it('把保留的 Authoring 消息审计投影为可恢复 turn 且不重复', () => {
    const { db, repository } = setupDatabase();
    db.prepare(
      `INSERT INTO authoring_chat_messages(id, thread_id, role, content, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run('message-1', 'thread-1', 'user', '重新编排登录模块', occurredAt);

    const context = { type: 'authoring' as const, id: 'job-1' };
    const first = repository.list(context);
    const second = repository.list(context);

    expect(first).toEqual([
      expect.objectContaining({
        type: 'turn.upsert',
        turn: expect.objectContaining({
          role: 'user',
          sections: [expect.objectContaining({ type: 'user', markdown: '重新编排登录模块' })],
        }),
      }),
    ]);
    expect(second).toHaveLength(1);
    expect(repository.snapshot(context).turns).toEqual([expect.objectContaining({ role: 'user' })]);
  });

  it('按独立 control/message 水位增量投影，并静默推进未映射事件', () => {
    const { repository } = setupDatabase();
    const context = { type: 'authoring' as const, id: 'job-1' };
    const controlEvent = (seq: number, type: string): SemanticEventV1 => ({
      id: `control-${seq}`,
      seq,
      schemaVersion: 1,
      type,
      entityType: 'decision',
      entityId: 'decision-1',
      payload: {},
      occurredAt,
    });
    const message = {
      seq: 1,
      id: 'message-1',
      role: 'user' as const,
      content: '重新编排登录模块',
      created_at: occurredAt,
    };

    repository.ingestControlEvent(context, controlEvent(1, 'decision.requested'));
    repository.ingestAuthoringMessage(context, message);
    repository.ingestControlEvent(context, controlEvent(1, 'decision.applied'));
    repository.ingestControlEvent(context, controlEvent(2, 'unmapped.event'));
    repository.ingestControlEvent(context, controlEvent(1, 'decision.requested'));
    repository.ingestControlEvent(context, controlEvent(3, 'decision.applied'));

    expect(repository.cursor(context, 'semantic-control:authoring')).toBe(3);
    expect(repository.cursor(context, 'semantic-authoring-messages')).toBe(1);
    expect(repository.listSynced(context).map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(repository.listSynced(context).map((event) => event.type)).toEqual([
      'section.upsert',
      'turn.upsert',
      'section.upsert',
    ]);
  });

  it.each([
    { source: 'control', failureAt: 'activity-event-insert' },
    { source: 'control', failureAt: 'cursor-upsert' },
    { source: 'message', failureAt: 'activity-event-insert' },
    { source: 'message', failureAt: 'cursor-upsert' },
  ] as const)(
    'keeps the $source source cursor at the failed event after a $failureAt failure',
    ({ source, failureAt }) => {
      const { db, repository } = setupDatabase();
      const context = { type: 'authoring' as const, id: 'job-1' };
      const sourceId =
        source === 'control' ? 'semantic-control:authoring' : 'semantic-authoring-messages';
      const triggerName = `fail_${failureAt.replaceAll('-', '_')}`;
      const targetTable =
        failureAt === 'activity-event-insert'
          ? 'semantic_agent_activity_events'
          : 'semantic_agent_activity_cursors';
      db.exec(
        `CREATE TRIGGER ${triggerName} BEFORE INSERT ON ${targetTable}
         WHEN NEW.source_task_id = '${sourceId}'
         BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END;`
      );

      const persistSourceEvent = (seq: number) => {
        if (source === 'control') {
          db.prepare(
            `INSERT INTO authoring_events
              (id, job_id, seq, type, entity_type, entity_id, payload_json, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            `control-${seq}`,
            context.id,
            seq,
            'decision.requested',
            'decision',
            'decision-1',
            '{}',
            occurredAt
          );
          return;
        }
        db.prepare(
          `INSERT INTO authoring_chat_messages(id, thread_id, role, content, created_at)
           VALUES (?, 'thread-1', 'user', ?, ?)`
        ).run(`message-${seq}`, `message content ${seq}`, occurredAt);
      };

      persistSourceEvent(1);
      expect(() => repository.syncControlEvents(context)).toThrow();
      expect(repository.cursor(context, sourceId)).toBe(0);
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM semantic_agent_activity_events WHERE source_task_id = ?'
          )
          .get(sourceId)
      ).toEqual({ count: 0 });
      expect(
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM semantic_agent_activity_cursors WHERE source_task_id = ?'
          )
          .get(sourceId)
      ).toEqual({ count: 0 });

      persistSourceEvent(2);
      db.exec(`DROP TRIGGER ${triggerName}`);
      expect(repository.syncControlEvents(context)).toBe(2);
      expect(repository.cursor(context, sourceId)).toBe(2);
      expect(
        db
          .prepare(
            `SELECT source_seq FROM semantic_agent_activity_events
             WHERE source_task_id = ? ORDER BY source_seq`
          )
          .all(sourceId)
      ).toEqual([{ source_seq: 1 }, { source_seq: 2 }]);
    }
  );

  it('keeps lower control seq ahead of a later seq even when its occurredAt is later', () => {
    const { db, repository } = setupDatabase();
    const context = { type: 'authoring' as const, id: 'job-1' };
    const laterTimestamp = '2026-08-27T10:00:00.000Z';
    const earlierTimestamp = '2026-08-27T08:00:00.000Z';
    const insertEvent = db.prepare(
      `INSERT INTO authoring_events
        (id, job_id, seq, type, entity_type, entity_id, payload_json, occurred_at)
       VALUES (?, ?, ?, 'decision.requested', 'decision', 'decision-1', '{}', ?)`
    );
    insertEvent.run('control-1', context.id, 1, laterTimestamp);
    insertEvent.run('control-2', context.id, 2, earlierTimestamp);

    expect(repository.syncControlEvents(context)).toBe(2);
    expect(repository.cursor(context, 'semantic-control:authoring')).toBe(2);
    expect(repository.listSynced(context).map((event) => event.occurredAt)).toEqual([
      laterTimestamp,
      earlierTimestamp,
    ]);
    expect(
      db
        .prepare(
          `SELECT source_seq FROM semantic_agent_activity_events
           WHERE source_task_id = 'semantic-control:authoring' ORDER BY seq`
        )
        .all()
    ).toEqual([{ source_seq: 1 }, { source_seq: 2 }]);
  });

  it('catches up CH3 from durable events without blocking CH4 when live projection fails', async () => {
    const { db, repository } = setupDatabase();
    const hub = new SemanticControlEventHub();
    const context = { type: 'authoring' as const, id: 'job-1' };
    const activitySnapshot = repository.snapshot(context);
    vi.spyOn(repository, 'snapshot').mockReturnValue(activitySnapshot);
    const authoringSnapshot: AuthoringSnapshotV1 = {
      schema: 'nebula.ai-e2e.authoring-snapshot/1.0',
      job: { id: context.id },
      tasks: [],
      attempts: [],
      decisions: [],
      contextThreads: [],
      amendments: [],
      seq: 0,
      stateVersion: 1,
    };
    const queryService = new SemanticQueryService(
      new SemanticQueryRepository(db, new BusinessVersionRepository(db))
    );
    vi.spyOn(queryService, 'getAuthoringSnapshot').mockReturnValue(authoringSnapshot);
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(errorHandlerPlugin);
    await app.register(semanticControlRoutes, {
      prefix: '/api/v1',
      service: queryService,
      eventHub: hub,
    });
    await app.register(agentActivityRoutes, {
      prefix: '/api/v1',
      repository,
      eventHub: hub,
    });
    const serverUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const activityController = new AbortController();
    const controlController = new AbortController();
    const projectedEventOrder: number[] = [];
    const unsubscribeProjection = repository.subscribe(context, (event) =>
      projectedEventOrder.push(event.seq)
    );

    try {
      const activityResponse = await fetch(
        new URL('/api/v1/authoring-jobs/job-1/activity', serverUrl),
        { signal: activityController.signal }
      );
      const activityReader = activityResponse.body?.getReader();
      if (!activityReader) throw new Error('Activity SSE response has no body');
      const controlResponse = await fetch(
        new URL('/api/v1/authoring-jobs/job-1/events', serverUrl),
        { signal: controlController.signal }
      );
      const controlReader = controlResponse.body?.getReader();
      if (!controlReader) throw new Error('Control SSE response has no body');
      const activityDecoder = new TextDecoder();
      const controlDecoder = new TextDecoder();
      const createFrameReader = (
        reader: ReadableStreamDefaultReader<Uint8Array>,
        decoder: TextDecoder
      ) => {
        let bufferedData = '';
        return async () => {
          while (true) {
            const frameEnd = bufferedData.indexOf('\n\n');
            if (frameEnd !== -1) {
              const frame = bufferedData.slice(0, frameEnd + 2);
              bufferedData = bufferedData.slice(frameEnd + 2);
              return frame;
            }
            const chunk = await reader.read();
            if (chunk.done) throw new Error('SSE response ended before the next frame');
            bufferedData += decoder.decode(chunk.value, { stream: true });
          }
        };
      };
      const readActivityFrame = createFrameReader(activityReader, activityDecoder);
      const readControlFrame = createFrameReader(controlReader, controlDecoder);

      const activitySnapshotFrame = await readActivityFrame();
      const controlSnapshotFrame = await readControlFrame();
      expect(activityResponse.status).toBe(200);
      expect(controlResponse.status).toBe(200);
      expect(activitySnapshotFrame).toBe(
        `event: agent_stream.snapshot\nid: ${activitySnapshot.seq}\ndata: ${JSON.stringify(activitySnapshot)}\n\n`
      );
      expect(controlSnapshotFrame).toBe(
        `id: ${authoringSnapshot.seq}\nevent: authoring.snapshot\nretry: 1000\ndata: ${JSON.stringify({
          schema: 'nebula.ai-e2e.snapshot-event/1.0',
          seq: authoringSnapshot.seq,
          stateVersion: authoringSnapshot.stateVersion,
          snapshot: authoringSnapshot,
        })}\n\n`
      );

      db.exec(`CREATE TRIGGER fail_activity_projection
        BEFORE INSERT ON semantic_agent_activity_events
        BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END`);
      const businessWriteResult = inImmediateTransaction(db, () => {
        db.prepare(
          `INSERT INTO authoring_events
            (id, job_id, seq, type, entity_type, entity_id, state_version,
             correlation_id, causation_id, payload_json, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          'control-1',
          context.id,
          1,
          'decision.requested',
          'decision',
          'decision-1',
          1,
          null,
          null,
          '{}',
          occurredAt
        );
        publishPersistedSemanticControlEvent(db, hub, 'authoring', context.id, 1);
        return 'business-write-committed';
      });
      expect(businessWriteResult).toBe('business-write-committed');
      expect(db.prepare('SELECT id FROM authoring_events WHERE seq = 1').get()).toEqual({
        id: 'control-1',
      });
      expect(repository.cursor(context, 'semantic-control:authoring')).toBe(0);
      expect(repository.listSynced(context)).toEqual([]);
      const firstActivityEventFrame = readActivityFrame();

      const controlEvent: SemanticEventV1 = {
        id: 'control-1',
        seq: 1,
        schemaVersion: 1,
        type: 'decision.requested',
        entityType: 'decision',
        entityId: 'decision-1',
        stateVersion: 1,
        payload: {},
        occurredAt,
      };
      let controlTimeout: ReturnType<typeof setTimeout> | undefined;
      const controlEventFrame = await Promise.race([
        readControlFrame(),
        new Promise<never>((_, reject) => {
          controlTimeout = setTimeout(
            () => reject(new Error('CH4 did not receive the live control event')),
            1_000
          );
        }),
      ]).finally(() => {
        if (controlTimeout) clearTimeout(controlTimeout);
      });
      expect(controlEventFrame).toBe(
        `id: ${controlEvent.seq}\nevent: ${controlEvent.type}\ndata: ${JSON.stringify(controlEvent)}\n\n`
      );

      db.exec('DROP TRIGGER fail_activity_projection');
      const recoveryEvent: SemanticEventV1 = {
        id: 'control-2',
        seq: 2,
        schemaVersion: 1,
        type: 'decision.applied',
        entityType: 'decision',
        entityId: 'decision-1',
        stateVersion: 2,
        payload: { decisionId: 'decision-1' },
        occurredAt,
      };
      expect(
        inImmediateTransaction(db, () => {
          db.prepare(
            `INSERT INTO authoring_events
              (id, job_id, seq, type, entity_type, entity_id, state_version,
               correlation_id, causation_id, payload_json, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            recoveryEvent.id,
            context.id,
            recoveryEvent.seq,
            recoveryEvent.type,
            recoveryEvent.entityType,
            recoveryEvent.entityId,
            recoveryEvent.stateVersion,
            null,
            null,
            JSON.stringify(recoveryEvent.payload),
            recoveryEvent.occurredAt
          );
          publishPersistedSemanticControlEvent(db, hub, 'authoring', context.id, recoveryEvent.seq);
          return 'recovery-write-committed';
        })
      ).toBe('recovery-write-committed');
      expect(await readControlFrame()).toBe(
        `id: ${recoveryEvent.seq}\nevent: ${recoveryEvent.type}\ndata: ${JSON.stringify(recoveryEvent)}\n\n`
      );

      const projectedEvents = repository.listSynced(context);
      expect(projectedEvents.map((event) => event.seq)).toEqual([1, 2]);
      expect(projectedEventOrder).toEqual([1, 2]);
      const [firstProjectedEvent, ...remainingProjectedEvents] = projectedEvents;
      if (!firstProjectedEvent) throw new Error('Recovered projection is missing its first event');
      expect(await firstActivityEventFrame).toBe(
        `event: agent_stream.event\nid: ${firstProjectedEvent.seq}\ndata: ${JSON.stringify(firstProjectedEvent)}\n\n`
      );
      for (const projectedEvent of remainingProjectedEvents) {
        expect(await readActivityFrame()).toBe(
          `event: agent_stream.event\nid: ${projectedEvent.seq}\ndata: ${JSON.stringify(projectedEvent)}\n\n`
        );
      }
    } finally {
      unsubscribeProjection();
      activityController.abort();
      controlController.abort();
    }
  });
});

describe('Agent activity routes', () => {
  it('仅返回请求上下文的数据并使用统一响应 envelope', async () => {
    const { repository } = setupDatabase();
    repository.append(
      { type: 'authoring', id: 'job-1' },
      'external-a',
      activityEvent('external-a', 4)
    );
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(errorHandlerPlugin);
    await app.register(agentActivityRoutes, { prefix: '/api/v1', repository });

    const visible = await app.inject({
      method: 'GET',
      url: '/api/v1/authoring-jobs/job-1/activity-log?afterSeq=0',
      headers: { 'x-correlation-id': 'corr-1' },
    });
    expect(visible.statusCode).toBe(200);
    expect(visible.json()).toMatchObject({
      data: [{ streamId: 'job-1', seq: 1 }],
      meta: { correlationId: 'corr-1' },
    });

    const isolated = await app.inject({
      method: 'GET',
      url: '/api/v1/authoring-jobs/job-2/activity-log?afterSeq=0',
    });
    expect(isolated.json()).toMatchObject({ data: [] });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/authoring-jobs/missing/activity-log',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('按原始 wire 顺序发送 activity snapshot 与 SSE 响应头', async () => {
    const { repository } = setupDatabase();
    const context = { type: 'authoring' as const, id: 'job-1' };
    repository.append(context, 'external-a', activityEvent('external-a', 4));
    const snapshot = repository.snapshot(context);
    const app = Fastify({ logger: false });
    apps.push(app);
    await app.register(errorHandlerPlugin);
    await app.register(agentActivityRoutes, { prefix: '/api/v1', repository });
    const serverUrl = await app.listen({ port: 0, host: '127.0.0.1' });
    const controller = new AbortController();

    try {
      const response = await fetch(new URL('/api/v1/authoring-jobs/job-1/activity', serverUrl), {
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Activity SSE response has no body');
      let frame = '';
      const decoder = new TextDecoder();
      while (!frame.endsWith('\n\n')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Activity SSE response ended before its snapshot');
        frame += decoder.decode(chunk.value, { stream: true });
      }

      expect(response.status).toBe(200);
      expect({
        contentType: response.headers.get('content-type'),
        cacheControl: response.headers.get('cache-control'),
        connection: response.headers.get('connection'),
        buffering: response.headers.get('x-accel-buffering'),
      }).toEqual({
        contentType: 'text/event-stream; charset=utf-8',
        cacheControl: 'no-cache, no-transform',
        connection: 'keep-alive',
        buffering: 'no',
      });
      expect(frame).toBe(
        `event: agent_stream.snapshot\nid: ${snapshot.seq}\ndata: ${JSON.stringify(snapshot)}\n\n`
      );
    } finally {
      controller.abort();
    }
  });
});
