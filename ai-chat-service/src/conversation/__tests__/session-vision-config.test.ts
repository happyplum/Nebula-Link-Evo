import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConversationDatabase } from '../../db/ConversationDatabase.js';
import { ConversationManager } from '../manager.js';

describe('Session legacy vision columns', () => {
  let manager: ConversationManager;

  beforeEach(() => {
    ConversationDatabase.resetInstance();
    manager = new ConversationManager(':memory:');
  });

  afterEach(async () => {
    await manager.close();
    ConversationDatabase.resetInstance();
  });

  it('stores null legacy vision fields when creating sessions', () => {
    const session = manager.createSession({
      title: 'No Vision Session',
      provider: 'openai',
      model: 'gpt-4o',
    });

    expect(session.vision_provider).toBeNull();
    expect(session.vision_model).toBeNull();
  });

  it('returns null legacy vision fields when fetching sessions', () => {
    const created = manager.createSession({
      title: 'Stored Vision',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const fetched = manager.getSession(created.id);

    expect(fetched?.vision_provider).toBeNull();
    expect(fetched?.vision_model).toBeNull();
  });

  it('includes null legacy vision fields in listed sessions', () => {
    manager.createSession({
      title: 'Vision A',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const sessions = manager.listSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.vision_provider).toBeNull();
    expect(sessions[0]?.vision_model).toBeNull();
  });

  it('keeps legacy vision fields empty for forked sessions', () => {
    const parent = manager.createSession({
      title: 'Parent No Vision',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const forked = manager.forkSession(parent.id);

    expect(forked.vision_provider).toBeNull();
    expect(forked.vision_model).toBeNull();
  });

  it('does not mutate legacy vision fields when updating regular fields', () => {
    const session = manager.createSession({
      title: 'Partial Update',
      provider: 'openai',
      model: 'gpt-4o',
    });

    const updated = manager.updateSession(session.id, {
      title: 'Renamed Session',
    });

    expect(updated?.title).toBe('Renamed Session');
    expect(updated?.vision_provider).toBeNull();
    expect(updated?.vision_model).toBeNull();
  });
});
