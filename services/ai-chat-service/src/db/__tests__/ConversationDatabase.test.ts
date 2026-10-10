import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationDatabase } from '../ConversationDatabase.js';

describe('ConversationDatabase', () => {
  let db: ConversationDatabase;

  beforeEach(() => {
    db = new ConversationDatabase();
    db.initialize(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates session, message, state, and event tables in the conversation DB', async () => {
    const session = db.createSession({
      title: 'T6 schema smoke',
      provider: 'test',
      model: 'test-model',
    });

    const message = db.createMessage({
      session_id: session.id,
      role: 'user',
      content: 'hello',
    });
    const state = await db.getSessionStateDAO().get(session.id);
    const occurredAt = new Date().toISOString();
    const seq = db.getSessionEventsDAO().appendEventSync(session.id, 'agent_stream.event', {
      type: 'section.upsert',
      turnId: `user:${message.id}`,
      sectionId: `user:${message.id}`,
      occurredAt,
      section: {
        type: 'user',
        sectionId: `user:${message.id}`,
        createdAt: occurredAt,
        updatedAt: occurredAt,
        markdown: message.content,
      },
    });

    expect(db.getMessagesBySession(session.id)).toHaveLength(1);
    expect(state?.status).toBe('idle');
    expect(seq).toBe(1);
  });

  it('uses sessions_state as the only session status source', async () => {
    const columns = (
      db.connection().prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    ).map((column) => column.name);
    expect(columns).not.toContain('status');
    expect(columns).not.toContain('vision_provider');
    expect(columns).not.toContain('vision_model');

    const session = db.createSession({ title: 'state', provider: 'test', model: 'test' });
    await db.getSessionStateDAO().get(session.id);
    db.getSessionStateDAO().transition(
      session.id,
      { status: 'running', jobId: 'run-1' },
      undefined,
      ['idle']
    );
    expect((await db.getSessionStateDAO().get(session.id))?.status).toBe('running');
    const { ChatSessionController } = await import('../../services/chat-session-controller.js');
    expect(await new ChatSessionController(db).recoverRunningSessions()).toEqual([session.id]);
    expect((await db.getSessionStateDAO().get(session.id))?.status).toBe('blocked');
  });
});
