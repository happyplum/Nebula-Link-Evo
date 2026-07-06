import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../conversation/db.js';
import type { CreateSessionParams, CreateMessageParams, CreateInteractionParams } from '../conversation/types.js';

describe('DatabaseManager', () => {
  let db: DatabaseManager;
  const testDbPath = ':memory:';

  beforeEach(() => {
    db = DatabaseManager.getInstance();
    db.initialize(testDbPath);
  });

  afterEach(() => {
    db.close();
  });

  describe('schema creation', () => {
    it('should create sessions table with correct schema', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create messages table with correct schema', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='messages'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create session_events table with correct schema', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='session_events'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create idx_messages_session_id index', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_session_id'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create idx_sessions_updated_at index', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sessions_updated_at'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create idx_session_events_seq index', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_events_seq'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create idx_session_events_ttl index', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_session_events_ttl'"
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('session CRUD', () => {
    it('should create a new session', () => {
      const params: CreateSessionParams = {
        title: 'Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      };
      const session = db.createSession(params);
      expect(session).toBeDefined();
      expect(session.id).toBeDefined();
      expect(session.title).toBe(params.title);
      expect(session.provider).toBe(params.provider);
      expect(session.model).toBe(params.model);
      expect(session.message_count).toBe(0);
      expect(session.summary).toBeNull();
    });

    it('should get session by id', () => {
      const params: CreateSessionParams = {
        title: 'Get Test Session',
        provider: 'nvidia',
        model: 'nv-vlm-1.0-vision',
      };
      const created = db.createSession(params);
      const retrieved = db.getSession(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.title).toBe(params.title);
    });

    it('should update session', () => {
      const params: CreateSessionParams = {
        title: 'Update Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      };
      const created = db.createSession(params);
      const updated = db.updateSession(created.id, {
        title: 'Updated Title',
        summary: 'Test summary',
      });
      expect(updated).toBeDefined();
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.summary).toBe('Test summary');
    });

    it('should delete session', () => {
      const params: CreateSessionParams = {
        title: 'Delete Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      };
      const created = db.createSession(params);
      db.deleteSession(created.id);
      const retrieved = db.getSession(created.id);
      expect(retrieved).toBeNull();
    });

    it('should list all sessions ordered by updated_at', () => {
      const session1 = db.createSession({
        title: 'Session 1',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      let counter = 0;
      while (counter < 1000000) {
        counter++;
      }
      const session2 = db.createSession({
        title: 'Session 2',
        provider: 'nvidia',
        model: 'nv-vlm-1.0-vision',
      });
      const sessions = db.listSessions();
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).toBe(session2.id);
      expect(sessions[1].id).toBe(session1.id);
    });
  });

  describe('message CRUD', () => {
    let sessionId: string;

    beforeEach(() => {
      const session = db.createSession({
        title: 'Message Test Session',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      sessionId = session.id;
    });

    it('should create a new message', () => {
      const params: CreateMessageParams = {
        session_id: sessionId,
        role: 'user',
        content: 'Hello, world!',
      };
      const message = db.createMessage(params);
      expect(message).toBeDefined();
      expect(message.id).toBeDefined();
      expect(message.session_id).toBe(params.session_id);
      expect(message.role).toBe(params.role);
      expect(message.content).toBe(params.content);
    });

    it('should get message by id', () => {
      const params: CreateMessageParams = {
        session_id: sessionId,
        role: 'assistant',
        content: 'Hi there!',
      };
      const created = db.createMessage(params);
      const retrieved = db.getMessage(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.content).toBe(params.content);
    });

    it('should get messages by session_id', () => {
      db.createMessage({
        session_id: sessionId,
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'Hello!',
      });
      db.createMessage({
        session_id: sessionId,
        role: 'assistant',
        content: 'Hi!',
      });
      const messages = db.getMessagesBySession(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe('system');
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });

    it('should delete message', () => {
      const params: CreateMessageParams = {
        session_id: sessionId,
        role: 'user',
        content: 'Delete me',
      };
      const created = db.createMessage(params);
      db.deleteMessage(created.id);
      const retrieved = db.getMessage(created.id);
      expect(retrieved).toBeNull();
    });

    it('should update session message_count when adding message', () => {
      const session = db.getSession(sessionId);
      expect(session?.message_count).toBe(0);
      db.createMessage({
        session_id: sessionId,
        role: 'user',
        content: 'First message',
      });
      const updated = db.getSession(sessionId);
      expect(updated?.message_count).toBe(1);
    });
  });

  describe('session with messages', () => {
    it('should cascade delete messages when session is deleted', () => {
      const session = db.createSession({
        title: 'Cascade Test',
        provider: 'kimi',
        model: 'moonshot-v1-vision-preview',
      });
      db.createMessage({
        session_id: session.id,
        role: 'user',
        content: 'Test message',
      });
      db.deleteSession(session.id);
      const messages = db.getMessagesBySession(session.id);
      expect(messages).toHaveLength(0);
    });
  });

  describe('interactions', () => {
    it('should keep operation_logs session_id as a soft reference', () => {
      const foreignKeys = db.executeSql('PRAGMA foreign_key_list(operation_logs)');
      expect(foreignKeys).toHaveLength(0);
    });

    it('should create interactions table with correct schema', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='interactions'"
      );
      expect(result).toHaveLength(1);
    });

    it('should create idx_interactions_timestamp index', () => {
      const result = db.executeSql(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_interactions_timestamp'"
      );
      expect(result).toHaveLength(1);
    });

    it('should insert an interaction', () => {
      const params: CreateInteractionParams = {
        action_type: 'click',
        target_type: 'button',
        locator_strategy: 'css',
        success: true,
        attempts: 1,
        latency_ms: 150,
      };
      const interaction = db.insertInteraction(params);
      expect(interaction).toBeDefined();
      expect(interaction.id).toBe(1);
      expect(interaction.action_type).toBe(params.action_type);
      expect(interaction.target_type).toBe(params.target_type);
      expect(interaction.success).toBe(params.success);
      expect(interaction.attempts).toBe(params.attempts);
      expect(interaction.latency_ms).toBe(params.latency_ms);
      expect(interaction.snapshot_id).toBeNull();
      expect(interaction.nebula_id).toBeNull();
    });

    it('should insert interaction with all fields', () => {
      const params: CreateInteractionParams = {
        timestamp: 1700000000000,
        snapshot_id: 'snapshot-123',
        nebula_id: 456,
        action_type: 'type',
        target_type: 'input',
        locator_strategy: 'xpath',
        success: false,
        attempts: 3,
        latency_ms: 500,
        error_code: 'TIMEOUT',
        error_message: 'Element not found',
      };
      const interaction = db.insertInteraction(params);
      expect(interaction.snapshot_id).toBe(params.snapshot_id);
      expect(interaction.nebula_id).toBe(params.nebula_id);
      expect(interaction.error_code).toBe(params.error_code);
      expect(interaction.error_message).toBe(params.error_message);
    });

    it('should query interactions without filters', () => {
      db.insertInteraction({
        action_type: 'click',
        target_type: 'button',
        success: true,
      });
      db.insertInteraction({
        action_type: 'type',
        target_type: 'input',
        success: false,
        attempts: 2,
      });
      const interactions = db.queryInteractions();
      expect(interactions).toHaveLength(2);
      expect(interactions[0].id).toBe(2);
      expect(interactions[1].id).toBe(1);
    });

    it('should query interactions with action_type filter', () => {
      db.insertInteraction({
        action_type: 'click',
        target_type: 'button',
        success: true,
      });
      db.insertInteraction({
        action_type: 'type',
        target_type: 'input',
        success: true,
      });
      db.insertInteraction({
        action_type: 'click',
        target_type: 'link',
        success: false,
      });
      const clickInteractions = db.queryInteractions({ action_type: 'click' });
      expect(clickInteractions).toHaveLength(2);
      expect(clickInteractions.every((i) => i.action_type === 'click')).toBe(true);
    });

    it('should query interactions with success filter', () => {
      db.insertInteraction({
        action_type: 'click',
        target_type: 'button',
        success: true,
      });
      db.insertInteraction({
        action_type: 'type',
        target_type: 'input',
        success: false,
      });
      db.insertInteraction({
        action_type: 'scroll',
        target_type: 'page',
        success: true,
      });
      const failedInteractions = db.queryInteractions({ success: false });
      expect(failedInteractions).toHaveLength(1);
      expect(failedInteractions[0].success).toBe(false);
    });

    it('should query interactions with limit and offset', () => {
      for (let i = 0; i < 5; i++) {
        db.insertInteraction({
          action_type: 'click',
          target_type: 'button',
          success: true,
          attempts: i,
        });
      }
      const page1 = db.queryInteractions({ limit: 2 });
      expect(page1).toHaveLength(2);
      expect(page1[0].attempts).toBe(4);
      expect(page1[1].attempts).toBe(3);

      const page2 = db.queryInteractions({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0].attempts).toBe(2);
      expect(page2[1].attempts).toBe(1);
    });

    it('should query interactions with timestamp range', () => {
      const now = Date.now();
      db.insertInteraction({
        timestamp: now - 2000,
        action_type: 'click',
        target_type: 'button',
        success: true,
      });
      db.insertInteraction({
        timestamp: now - 1000,
        action_type: 'type',
        target_type: 'input',
        success: true,
      });
      db.insertInteraction({
        timestamp: now,
        action_type: 'scroll',
        target_type: 'page',
        success: true,
      });
      const recent = db.queryInteractions({
        start_time: now - 1500,
        end_time: now + 500,
      });
      expect(recent).toHaveLength(2);
      expect(recent.every((i) => i.timestamp >= now - 1500 && i.timestamp <= now + 500)).toBe(true);
    });

    it('should calculate interaction stats', () => {
      db.insertInteraction({
        action_type: 'click',
        target_type: 'button',
        success: true,
        attempts: 1,
        latency_ms: 100,
      });
      db.insertInteraction({
        action_type: 'click',
        target_type: 'link',
        success: true,
        attempts: 1,
        latency_ms: 150,
      });
      db.insertInteraction({
        action_type: 'type',
        target_type: 'input',
        success: false,
        attempts: 2,
        latency_ms: 300,
      });
      db.insertInteraction({
        action_type: 'scroll',
        target_type: 'page',
        success: false,
      });

      const stats = db.getStats();
      expect(stats.total).toBe(4);
      expect(stats.success_count).toBe(2);
      expect(stats.failure_count).toBe(2);
      expect(stats.success_rate).toBe(50);
      expect(stats.avg_latency_ms).toBeCloseTo(183.33, 1);
      expect(stats.avg_attempts).toBeCloseTo(1.33, 1);
      expect(stats.by_action_type).toEqual({ click: 2, type: 1, scroll: 1 });
      expect(stats.by_target_type).toEqual({ button: 1, link: 1, input: 1, page: 1 });
    });

    it('should handle empty interactions stats', () => {
      const stats = db.getStats();
      expect(stats.total).toBe(0);
      expect(stats.success_count).toBe(0);
      expect(stats.failure_count).toBe(0);
      expect(stats.success_rate).toBe(0);
      expect(stats.avg_latency_ms).toBeNull();
      expect(stats.avg_attempts).toBeNull();
      expect(stats.by_action_type).toEqual({});
      expect(stats.by_target_type).toEqual({});
    });
  });
});
