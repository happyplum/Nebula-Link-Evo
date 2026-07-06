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
});
