import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ConversationDatabase } from '../db/ConversationDatabase.js';
import { createHarnessRuntime } from './runtime.js';
import { HarnessDeletionService, type DeletionChatRuntime } from './deletion-service.js';
import type { HarnessRuntime } from './types.js';

class DeletionAdapter extends LlmAdapter {
  override providerInfo(provider: string) {
    return { id: provider, name: provider };
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'ok' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('HarnessDeletionService', () => {
  it('physically purges a durable session and decrements attachment refs once', async () => {
    const fixture = await createFixture('delete-complete');
    const service = new HarnessDeletionService(fixture.db.connection(), fixture.chat, fixture.runtime);
    try {
      await expect(service.deleteSession(fixture.sessionId)).resolves.toBe('deleted');
      expect(fixture.db.getSession(fixture.sessionId)).toBeNull();
      expect(await fixture.runtime.revision(SessionId(fixture.sessionId))).toBeUndefined();
      expect(
        fixture.db.connection().prepare('SELECT phase FROM deletion_jobs WHERE resource_id = ?').get(
          fixture.sessionId
        )
      ).toEqual({ phase: 'completed' });
      expect(
        fixture.db.connection().prepare('SELECT ref_count FROM harness_attachments WHERE content_hash = ?').get(
          'sha256:test'
        )
      ).toEqual({ ref_count: 1 });

      await expect(service.deleteSession(fixture.sessionId)).resolves.toBe('deleted');
      expect(
        fixture.db.connection().prepare('SELECT ref_count FROM harness_attachments WHERE content_hash = ?').get(
          'sha256:test'
        )
      ).toEqual({ ref_count: 1 });
    } finally {
      await fixture.runtime.dispose();
      await fixture.db.close();
    }
  }, 20_000);

  it('resumes from the persisted flush boundary after a purge crash', async () => {
    const fixture = await createFixture('delete-recover');
    const failingHarness: HarnessRuntime = {
      ...fixture.runtime,
      purge: vi.fn(async () => {
        throw new Error('simulated purge crash');
      }),
    };
    const first = new HarnessDeletionService(fixture.db.connection(), fixture.chat, failingHarness);
    try {
      await expect(first.deleteSession(fixture.sessionId)).rejects.toThrow('simulated purge crash');
      expect(fixture.db.getSession(fixture.sessionId)).not.toBeNull();
      expect(
        fixture.db
          .connection()
          .prepare('SELECT phase, expected_revision FROM deletion_jobs WHERE resource_id = ?')
          .get(fixture.sessionId)
      ).toEqual({ phase: 'flushed', expected_revision: fixture.revision });

      const resumed = new HarnessDeletionService(
        fixture.db.connection(),
        fixture.chat,
        fixture.runtime
      );
      await expect(resumed.resumePending()).resolves.toBe(1);
      expect(fixture.db.getSession(fixture.sessionId)).toBeNull();
      expect(await fixture.runtime.revision(SessionId(fixture.sessionId))).toBeUndefined();
    } finally {
      await fixture.runtime.dispose();
      await fixture.db.close();
    }
  }, 20_000);
});

async function createFixture(name: string): Promise<{
  root: string;
  sessionId: string;
  revision: string;
  db: ConversationDatabase;
  runtime: HarnessRuntime;
  chat: DeletionChatRuntime;
}> {
  const root = await mkdtemp(join(tmpdir(), `nebula-${name}-`));
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
      ctx.llm.registerAdapter(['test'], new DeletionAdapter());
    },
  });
  const db = new ConversationDatabase();
  db.initialize(':memory:');
  const sessionId = name;
  db.createSession({ id: sessionId, title: name, provider: 'test', model: 'test' });
  db.getSessionStateDAO().create({ sessionId, status: 'idle' });
  const now = new Date().toISOString();
  db.connection()
    .prepare(
      `INSERT INTO harness_attachments(content_hash, ref_count, size_bytes, created_at)
       VALUES ('sha256:test', 2, 10, ?)`
    )
    .run(now);
  db.connection()
    .prepare(
      `INSERT INTO harness_attachment_refs(session_id, content_hash, ref_count)
       VALUES (?, 'sha256:test', 1)`
    )
    .run(sessionId);
  const handle = await runtime.openSession({
    sessionId: SessionId(sessionId),
    route: { provider: 'test', model: 'test' },
  });
  await handle.followup('delete me');
  await handle.flush();
  await handle.dispose();
  const revision = String(await runtime.revision(SessionId(sessionId)));
  const chat: DeletionChatRuntime = {
    cancelAndDrain: vi.fn(async () => {}),
    catchUpDurable: vi.fn(async () => revision),
  };
  return { root, sessionId, revision, db, runtime, chat };
}
