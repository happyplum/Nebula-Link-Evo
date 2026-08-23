import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ConversationDatabase } from '../db/ConversationDatabase.js';
import { createHarnessRuntime } from './runtime.js';
import { HarnessProjectionStore } from './projection-store.js';

class ProjectionAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'reasoning' };
    yield { type: 'reasoning-delta', index: 0, text: '思考' };
    yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '思考' } };
    yield { type: 'block-start', index: 1, blockType: 'text' };
    yield { type: 'text-delta', index: 1, text: '回答' };
    yield { type: 'block-end', index: 1, block: { type: 'text', text: '回答' } };
    yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('HarnessProjectionStore', () => {
  it('projects a durable prefix once and resumes from its watermark', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nebula-projection-'));
    roots.push(root);
    const runtime = await createHarnessRuntime({
      sessionRoot: join(root, 'sessions'),
      attachmentRoot: join(root, 'attachments'),
      persona: 'test',
      maxParallelToolCalls: 4,
      piAi: { providers: {} },
      decision: { provider: 'test', model: 'test' },
      mcp: [],
      configure(ctx) {
        ctx.llm.registerAdapter(['test'], new ProjectionAdapter());
      },
    });
    const db = new ConversationDatabase();
    db.initialize(':memory:');
    db.createSession({ id: 'chat-1', title: 'chat', provider: 'test', model: 'test' });
    db.getSessionStateDAO().create({ sessionId: 'chat-1', status: 'idle' });
    const projection = new HarnessProjectionStore(db.connection(), db.getSessionEventsDAO());
    const handle = await runtime.openSession({
      sessionId: SessionId('chat-1'),
      route: { provider: 'test', model: 'test' },
    });
    try {
      await handle.followup('问题', 'public-user-message');
      const durableSeq = await handle.flush();
      const durable = await runtime.readDurable(SessionId('chat-1'));
      const first = projection.catchUp('chat-1', durableSeq, durable.events, 'revision-1');
      expect(first.projectedDshSeq).toBe(durableSeq);
      expect(first.publicEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          'assistant.started',
          'message.created',
          'assistant.thinking',
          'assistant.delta',
          'assistant.completed',
        ])
      );
      expect(db.getMessagesBySession('chat-1').map((message) => [message.role, message.content])).toEqual([
        ['user', '问题'],
        ['assistant', '回答'],
      ]);

      const replay = projection.catchUp('chat-1', durableSeq, durable.events, 'revision-1');
      expect(replay.publicEvents).toEqual([]);
      expect(db.getMessagesBySession('chat-1')).toHaveLength(2);
      expect(projection.state('chat-1')).toEqual({
        projectedDshSeq: durableSeq,
        durableDshSeq: durableSeq,
        deleted: false,
      });
    } finally {
      await handle.dispose();
      await runtime.dispose();
      await db.close();
    }
  }, 20_000);

  it('refuses a projection watermark beyond the durable prefix', () => {
    const db = new ConversationDatabase();
    db.initialize(':memory:');
    db.createSession({ id: 'chat-corrupt', title: 'chat', provider: 'test', model: 'test' });
    db.getSessionStateDAO().create({ sessionId: 'chat-corrupt', status: 'idle' });
    const projection = new HarnessProjectionStore(db.connection(), db.getSessionEventsDAO());
    projection.state('chat-corrupt');
    db.connection()
      .prepare(
        'UPDATE harness_session_projection SET projected_dsh_seq = 2 WHERE session_id = ?'
      )
      .run('chat-corrupt');
    expect(() => projection.catchUp('chat-corrupt', 1, [])).toThrow(/exceeds durable DSH seq/);
  });

  it('rejects normal projection after tombstone while allowing deletion catch-up', () => {
    const db = new ConversationDatabase();
    db.initialize(':memory:');
    db.createSession({ id: 'chat-deleting', title: 'chat', provider: 'test', model: 'test' });
    db.getSessionStateDAO().create({ sessionId: 'chat-deleting', status: 'idle' });
    const projection = new HarnessProjectionStore(db.connection(), db.getSessionEventsDAO());
    projection.tombstone('chat-deleting');
    expect(() => projection.catchUp('chat-deleting', 0, [])).toThrow(/deleted/);
    expect(
      projection.catchUp('chat-deleting', 0, [], undefined, { allowDeleted: true })
    ).toMatchObject({ projectedDshSeq: 0, durableDshSeq: 0 });
  });
});
