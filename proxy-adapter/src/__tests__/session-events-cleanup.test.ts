import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { SessionEventsDAO } from '../conversation/session-events-dao.js';
import { SessionEventsCleanup } from '../services/session-events-cleanup.js';
import { DatabaseManager } from '../conversation/db.js';

describe('SessionEventsCleanup', () => {
  let cleanup: SessionEventsCleanup;
  let dao: SessionEventsDAO;
  let dbManager: DatabaseManager;
  let db: DatabaseSync;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    dbManager = DatabaseManager.getInstance();
    dbManager.initialize(':memory:');
    db = (dbManager as unknown as { db: DatabaseSync }).db;
    dao = new SessionEventsDAO(db);
    cleanup = new SessionEventsCleanup(db, dao, false);

    dbManager.createSession({
      id: sessionId,
      title: 'Test Session',
      provider: 'test',
      model: 'test-model',
    });
  });

  afterEach(() => {
    cleanup.stop();
    dao.dispose();
    dbManager.close();
  });

  describe('cleanupExpired', () => {
    it('should delete expired events', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"expired"}', pastDate, pastDate);

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 2, 'message.created', '{"content":"permanent"}', pastDate, null);

      const deleted = await cleanup.cleanupExpired();

      expect(deleted).toBe(1);

      const remaining = db
        .prepare('SELECT * FROM session_events WHERE session_id = ?')
        .all(sessionId) as unknown[];

      expect(remaining).toHaveLength(1);
    });

    it('should return 0 if no expired events', async () => {
      const futureDate = new Date(Date.now() + 3600000).toISOString();

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"active"}', new Date().toISOString(), futureDate);

      const deleted = await cleanup.cleanupExpired();

      expect(deleted).toBe(0);
    });

    it('should run WAL checkpoint after cleanup', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"expired"}', pastDate, pastDate);

      const checkpointSpy = vi.spyOn(db, 'exec');

      await cleanup.cleanupExpired();

      expect(checkpointSpy).toHaveBeenCalledWith('PRAGMA wal_checkpoint(PASSIVE)');
    });

    it('should handle multiple expired events', async () => {
      const pastDate = new Date(Date.now() - 3600000).toISOString();

      for (let i = 0; i < 5; i++) {
        db.prepare(
          `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(sessionId, i + 1, 'assistant.delta', `{"text":"expired-${i}"}`, pastDate, pastDate);
      }

      const deleted = await cleanup.cleanupExpired();

      expect(deleted).toBe(5);

      const remaining = db
        .prepare('SELECT * FROM session_events WHERE session_id = ?')
        .all(sessionId) as unknown[];

      expect(remaining).toHaveLength(0);
    });
  });

  describe('start', () => {
    it('should schedule cleanup timer', () => {
      vi.useFakeTimers();

      const timerSpy = vi.spyOn(global, 'setTimeout');
      cleanup.start();

      expect(timerSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should log next cleanup time', () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'log');

      cleanup.start();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('SessionEventsCleanup: Next cleanup scheduled for')
      );

      vi.useRealTimers();
    });
  });

  describe('stop', () => {
    it('should clear cleanup timer', () => {
      vi.useFakeTimers();

      cleanup.start();

      // Get the timer reference from cleanup instance
      const cleanupInstance = cleanup as unknown as { cleanupTimer: ReturnType<typeof setTimeout> | null };
      expect(cleanupInstance.cleanupTimer).not.toBeNull();

      cleanup.stop();

      expect(cleanupInstance.cleanupTimer).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('calculateNextRunTime', () => {
    it('should calculate next 3 AM UTC correctly for time before 3 AM UTC', () => {
      vi.useFakeTimers();
      // Set current time to 2:30 AM UTC
      const now = new Date(Date.UTC(2024, 0, 1, 2, 30, 0));
      vi.setSystemTime(now);

      cleanup.start();

      const logSpy = vi.spyOn(console, 'log');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Next cleanup scheduled for')
      );

      vi.useRealTimers();
    });

    it('should calculate next 3 AM UTC for time after 3 AM UTC', () => {
      vi.useFakeTimers();
      // Set current time to 4:00 AM UTC
      const now = new Date(Date.UTC(2024, 0, 1, 4, 0, 0));
      vi.setSystemTime(now);

      cleanup.start();

      const logSpy = vi.spyOn(console, 'log');
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Next cleanup scheduled for')
      );

      vi.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('should log error if cleanup fails', async () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error');
      const errorSpy = vi.spyOn(dao, 'cleanupExpired').mockRejectedValueOnce(new Error('DB error'));

      await expect(cleanup.cleanupExpired()).rejects.toThrow('DB error');
      expect(consoleSpy).toHaveBeenCalledWith(
        'SessionEventsCleanup: Failed to cleanup expired events',
        expect.any(Error)
      );

      vi.useRealTimers();
    });

    it('should handle WAL checkpoint errors gracefully', async () => {
      vi.useFakeTimers();
      const consoleSpy = vi.spyOn(console, 'error');
      const execSpy = vi.spyOn(db, 'exec').mockImplementationOnce(() => {
        throw new Error('WAL checkpoint error');
      });

      // Create an expired event
      const pastDate = new Date(Date.now() - 3600000).toISOString();
      db.prepare(
        `INSERT INTO session_events (session_id, seq, event_type, payload, created_at, ttl_expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(sessionId, 1, 'assistant.delta', '{"text":"expired"}', pastDate, pastDate);

      // Should still delete events even if checkpoint fails
      const deleted = await cleanup.cleanupExpired();

      expect(deleted).toBe(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        'SessionEventsCleanup: WAL checkpoint failed',
        expect.any(Error)
      );

      vi.useRealTimers();
    });
  });
});
