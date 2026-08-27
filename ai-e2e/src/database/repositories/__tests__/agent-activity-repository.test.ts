import Fastify from 'fastify';
import Database from 'better-sqlite3';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import { afterEach, describe, expect, it } from 'vitest';
import { up as migrateAgentActivity } from '../../migrations/020-agent-activity.js';
import { AgentActivityRepository } from '../agent-activity-repository.js';
import errorHandlerPlugin from '../../../server/plugins/error-handler.js';
import agentActivityRoutes from '../../../server/routes/agent-activity.js';

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
      job_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL
    );
    CREATE TABLE run_events (
      run_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
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
  state: 'running' | 'completed' | 'outcome_unknown' = 'running'
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
});
