import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConversationManager } from '../manager.js';

describe('Session vision model configuration', () => {
  let manager: ConversationManager;

  beforeEach(() => {
    manager = new ConversationManager(':memory:');
    manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
  });

  describe('createSession with vision fields', () => {
    it('should persist vision_provider and vision_model when provided', () => {
      const session = manager.createSession({
        title: 'Vision Session',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      });

      expect(session.vision_provider).toBe('anthropic');
      expect(session.vision_model).toBe('claude-3-5-sonnet');
    });

    it('should store null when vision fields are omitted', () => {
      const session = manager.createSession({
        title: 'No Vision Session',
        provider: 'openai',
        model: 'gpt-4o',
      });

      expect(session.vision_provider).toBeNull();
      expect(session.vision_model).toBeNull();
    });

    it('should persist only vision_provider', () => {
      const session = manager.createSession({
        title: 'Partial Vision',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'kimi',
      });

      expect(session.vision_provider).toBe('kimi');
      expect(session.vision_model).toBeNull();
    });
  });

  describe('getSession returns vision fields', () => {
    it('should return vision fields from stored session', () => {
      const created = manager.createSession({
        title: 'Stored Vision',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'nvidia',
        vision_model: 'nv-vlm-1.0-vision',
      });

      const fetched = manager.getSession(created.id);
      expect(fetched?.vision_provider).toBe('nvidia');
      expect(fetched?.vision_model).toBe('nv-vlm-1.0-vision');
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
    it('should include vision_provider and vision_model in listed sessions', () => {
      manager.createSession({
        title: 'Vision A',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      });

      const sessions = manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].vision_provider).toBe('anthropic');
      expect(sessions[0].vision_model).toBe('claude-3-5-sonnet');
    });
  });

  describe('forkSession inherits vision fields', () => {
    it('should inherit vision_provider and vision_model from parent', () => {
      const parent = manager.createSession({
        title: 'Parent Session',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      });

      const forked = manager.forkSession(parent.id);
      expect(forked.vision_provider).toBe('anthropic');
      expect(forked.vision_model).toBe('claude-3-5-sonnet');
      expect(forked.provider).toBe('openai');
      expect(forked.model).toBe('gpt-4o');
    });

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

  describe('updateSession with vision fields', () => {
    it('should update vision_provider and vision_model', () => {
      const session = manager.createSession({
        title: 'Update Test',
        provider: 'openai',
        model: 'gpt-4o',
      });

      const updated = manager.updateSession(session.id, {
        vision_provider: 'kimi',
        vision_model: 'moonshot-v1-vision-preview',
      });

      expect(updated?.vision_provider).toBe('kimi');
      expect(updated?.vision_model).toBe('moonshot-v1-vision-preview');
    });

    it('should clear vision fields by setting to null', () => {
      const session = manager.createSession({
        title: 'Clear Vision',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      });

      const updated = manager.updateSession(session.id, {
        vision_provider: null,
        vision_model: null,
      });

      expect(updated?.vision_provider).toBeNull();
      expect(updated?.vision_model).toBeNull();
    });

    it('should update only vision_provider without affecting vision_model', () => {
      const session = manager.createSession({
        title: 'Partial Update',
        provider: 'openai',
        model: 'gpt-4o',
        vision_provider: 'anthropic',
        vision_model: 'claude-3-5-sonnet',
      });

      const updated = manager.updateSession(session.id, {
        vision_provider: 'kimi',
      });

      expect(updated?.vision_provider).toBe('kimi');
      expect(updated?.vision_model).toBe('claude-3-5-sonnet');
    });
  });
});
