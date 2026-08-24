import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationDatabase } from '../ConversationDatabase.js';

describe('ConversationDatabase', () => {
  let db: ConversationDatabase;

  beforeEach(() => {
    ConversationDatabase.resetInstance();
    db = ConversationDatabase.getInstance();
    db.initialize(':memory:');
  });

  afterEach(async () => {
    await db.close();
    ConversationDatabase.resetInstance();
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
    const seq = db.getSessionEventsDAO().appendEventSync(session.id, 'message.created', {
      sessionId: session.id,
      messageId: message.id,
      content: message.content,
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
    db.activateSession(session.id);
    expect(await db.getSessionStateDAO().getStatus(session.id)).toBe('running');
    expect(db.recoverRunningSessions()).toEqual([{ id: session.id, status: 'blocked' }]);
    expect(await db.getSessionStateDAO().getStatus(session.id)).toBe('blocked');
  });
});
