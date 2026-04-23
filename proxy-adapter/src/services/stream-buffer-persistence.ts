/**
 * Stream Buffer Persistence Manager
 *
 * Manages persistence and retrieval of stream buffer chunks.
 * Integrates with StreamPersistWorker for async persistence,
 * and provides methods for loading chunks from disk and cleanup.
 *
 * Key Features:
 * - loadFromDisk(sessionId, fromIndex): Load chunks from SQLite
 * - cleanupOldChunks(olderThanHours): Remove old chunks
 * - Auto-cleanup on initialization (24 hours)
 */

import { DatabaseSync } from 'node:sqlite';

import type {
  StreamChunk as PersistStreamChunk,
} from './stream-persist-worker.types.js';
import { createWorkerLogger } from './logger.js';

// Re-export for convenience
export type { PersistStreamChunk };

const logger = createWorkerLogger('StreamBufferPersistence');

export interface StreamBufferPersistenceOptions {
  dbPath?: string;
  autoCleanup?: boolean;
  cleanupInterval?: number; // in hours, default 24
}

export class StreamBufferPersistenceManager {
  private db: DatabaseSync | null = null;
  private cleanupIntervalMs: number;
  private isInitialized: boolean = false;

  constructor(options: StreamBufferPersistenceOptions = {}) {
    this.cleanupIntervalMs = (options.cleanupInterval ?? 24) * 60 * 60 * 1000;
    this.initialize(options.dbPath);

    if (options.autoCleanup !== false) {
      this.schedulePeriodicCleanup();
    }
  }

  private initialize(dbPath?: string): void {
    if (this.isInitialized) {
      return;
    }

    const path = dbPath || process.env.DATABASE_PATH || './conversations.sqlite';
    this.db = new DatabaseSync(path);

    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL');

    this.isInitialized = true;
  }

  /**
   * Load stream chunks from disk for a given session.
   *
   * @param sessionId - Session identifier
   * @param fromIndex - Start loading from this index (inclusive)
   * @returns Array of stream chunks
   */
  loadFromDisk(sessionId: string, fromIndex: number = 0): PersistStreamChunk[] {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      `SELECT chunk_index, chunk_type, chunk_text, version, timestamp
       FROM stream_buffer_chunks
       WHERE session_id = ? AND chunk_index >= ?
       ORDER BY chunk_index ASC`
    );

    const rows = stmt.all(sessionId, fromIndex) as ChunkRow[];

    return rows.map((row) => ({
      index: row.chunk_index,
      type: row.chunk_type,
      text: row.chunk_text,
      version: row.version,
      timestamp: row.timestamp,
    })) as PersistStreamChunk[];
  }

  /**
   * Get the last chunk index for a session.
   *
   * @param sessionId - Session identifier
   * @returns Last chunk index or -1 if no chunks exist
   */
  getLastChunkIndex(sessionId: string): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      `SELECT MAX(chunk_index) as last_index
       FROM stream_buffer_chunks
       WHERE session_id = ?`
    );

    const result = stmt.get(sessionId) as { last_index: number | null };

    return result.last_index ?? -1;
  }

  /**
   * Get total count of chunks for a session.
   *
   * @param sessionId - Session identifier
   * @returns Number of chunks
   */
  getChunkCount(sessionId: string): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(
      `SELECT COUNT(*) as count
       FROM stream_buffer_chunks
       WHERE session_id = ?`
    );

    const result = stmt.get(sessionId) as { count: number };

    return result.count;
  }

  /**
   * Remove old stream chunks from the database.
   *
   * @param olderThanHours - Remove chunks older than this many hours
   * @returns Number of chunks removed
   */
  cleanupOldChunks(olderThanHours: number = 24): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const cutoffDate = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString();

    const deleteStmt = this.db.prepare(
      `DELETE FROM stream_buffer_chunks
       WHERE created_at < ?`
    );

    const result = deleteStmt.run(cutoffDate);

    logger.info({ changes: result.changes, olderThanHours }, 'Cleaned up old chunks');

    return result.changes;
  }

  /**
   * Remove all chunks for a specific session.
   *
   * @param sessionId - Session identifier
   * @returns Number of chunks removed
   */
  cleanupSession(sessionId: string): number {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const deleteStmt = this.db.prepare(
      `DELETE FROM stream_buffer_chunks
       WHERE session_id = ?`
    );

    const result = deleteStmt.run(sessionId);

    logger.info({ changes: result.changes, sessionId }, 'Cleaned up session chunks');

    return result.changes;
  }

  /**
   * Schedule periodic cleanup of old chunks.
   */
  private schedulePeriodicCleanup(): void {
    setInterval(() => {
      const hours = this.cleanupIntervalMs / (60 * 60 * 1000);
      this.cleanupOldChunks(hours);
    }, this.cleanupIntervalMs);
  }

  /**
   * Close database connection and cleanup.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
    }
  }
}

interface ChunkRow {
  chunk_index: number;
  chunk_type: string;
  chunk_text: string;
  version: number;
  timestamp: string;
}
