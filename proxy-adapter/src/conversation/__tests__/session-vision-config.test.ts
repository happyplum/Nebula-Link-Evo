import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../manager.js';

describe('Session legacy vision columns', () => {
  let manager: ConversationManager;

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('createSession no longer writes vision fields', () => {
    it('should store null when vision fields are omitted', () => {
      const session = manager.createSession({
        title: 'No Vision Session',
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(session.vision_provider).toBeNull();
      expect(session.vision_model).toBeNull();
    });
  });

  describe('getSession returns vision fields', () => {
    it('should return null legacy vision fields for new sessions', () => {
      const created = manager.createSession({
        title: 'Stored Vision',
        provider: 'openai',
        model: 'gpt-4o',
      });

      const fetched = manager.getSession(created.id);
      expect(fetched?.vision_provider).toBeNull();
      expect(fetched?.vision_model).toBeNull();
    });

    it('should return null vision fields for sessions without vision config', () => {
      const created = manager.createSession({
        title: 'No Vision',
        provider: 'openai',
        model: 'gpt-4o',
      });

      const fetched = manager.getSession(created.id);
      expect(fetched?.vision_provider).toBeNull();
      expect(fetched?.vision_model).toBeNull();
    });
  });

  describe('listSessions includes vision fields', () => {
    it('should expose null legacy vision columns in listed sessions', () => {
      manager.createSession({
        title: 'Vision A',
        provider: 'openai',
        model: 'gpt-4o',
      });

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].vision_provider).toBeNull();
      expect(sessions[0].vision_model).toBeNull();
    });
  });

  describe('forkSession keeps legacy vision fields empty for new sessions', () => {
    it('should inherit null vision fields from parent without vision config', () => {
      const parent = manager.createSession({
        title: 'Parent No Vision',
        provider: 'openai',
        model: 'gpt-4o',
      });

      const forked = manager.forkSession(parent.id);
      expect(forked.vision_provider).toBeNull();
      expect(forked.vision_model).toBeNull();
    });
  });

  describe('updateSession no longer mutates legacy vision fields', () => {
    it('should keep legacy vision fields untouched when updating regular fields', () => {
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
});
