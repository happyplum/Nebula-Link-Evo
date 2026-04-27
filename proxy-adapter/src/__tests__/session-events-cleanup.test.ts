import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('pino', () => ({
  default: vi.fn(() => mockLogger),
}));

vi.mock('../services/logger.js', () => ({
  createWorkerLogger: vi.fn(() => mockLogger),
}));

describe('SessionEventsCleanup', () => {
  let cleanup: import('../services/session-events-cleanup.js').SessionEventsCleanup;
  let dao: import('../conversation/session-events-dao.js').SessionEventsDAO;
  let dbManager: import('../conversation/db.js').DatabaseManager;
  let db: DatabaseSync;
  const sessionId = 'test-session-id';

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const [{ SessionEventsDAO }, { SessionEventsCleanup }, { DatabaseManager }] = await Promise.all([
      import('../conversation/session-events-dao.js'),
      import('../services/session-events-cleanup.js'),
      import('../conversation/db.js'),
    ]);

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

      cleanup.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          nextRun: expect.any(String),
          delayMinutes: expect.any(Number),
        }),
        'Next cleanup scheduled'
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

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          nextRun: '2024-01-01T03:00:00.000Z',
          delayMinutes: 30,
        }),
        'Next cleanup scheduled'
      );

      vi.useRealTimers();
    });

    it('should calculate next 3 AM UTC for time after 3 AM UTC', () => {
      vi.useFakeTimers();
      // Set current time to 4:00 AM UTC
      const now = new Date(Date.UTC(2024, 0, 1, 4, 0, 0));
      vi.setSystemTime(now);

      cleanup.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          nextRun: '2024-01-02T03:00:00.000Z',
          delayMinutes: 1380,
        }),
        'Next cleanup scheduled'
      );

      vi.useRealTimers();
    });
  });

  describe('error handling', () => {
    it('should log error if cleanup fails', async () => {
      vi.useFakeTimers();
      const error = new Error('DB error');
      vi.spyOn(dao, 'cleanupExpired').mockRejectedValueOnce(error);

      await expect(cleanup.cleanupExpired()).rejects.toThrow('DB error');
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: error },
        'Failed to cleanup expired events'
      );

      vi.useRealTimers();
    });

    it('should handle WAL checkpoint errors gracefully', async () => {
      vi.useFakeTimers();
      const checkpointError = new Error('WAL checkpoint error');
      vi.spyOn(db, 'exec').mockImplementationOnce(() => {
        throw checkpointError;
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
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: checkpointError },
        'WAL checkpoint failed'
      );

      vi.useRealTimers();
    });
  });
});
