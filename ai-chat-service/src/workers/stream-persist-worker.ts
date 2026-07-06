/**
 * Stream Persistence Worker (Worker Thread)
 *
 * Handles persistence of stream chunks in a separate worker thread.
 * Receives PersistRequest messages, inserts chunks into database,
 * and sends PersistResponse ACK back to main thread.
 *
 * This runs in a separate Node.js worker thread.
 */

import { parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import type {
  PersistRequest,
  PersistResponse,
} from '../services/stream-persist-worker.types.js';

// Initialize database connection
// Use environment variable if set, otherwise default to conversations.sqlite
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ai-chat-service', 'conversations.sqlite');
const db = new DatabaseSync(dbPath);

// Enable WAL mode for better concurrency
db.exec('PRAGMA journal_mode = WAL');

// Create table if not exists
// Note: Foreign key constraint removed for testing purposes
// In production, you would create the sessions table first
db.exec(`
  CREATE TABLE IF NOT EXISTS stream_buffer_chunks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_type TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    version INTEGER NOT NULL,
    timestamp TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_stream_buffer_session_id 
  ON stream_buffer_chunks(session_id)
`);

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_stream_buffer_created_at 
  ON stream_buffer_chunks(created_at DESC)
`);

/**
 * Handle persist requests from main thread
 */
if (parentPort) {
  parentPort.on('message', (request: PersistRequest) => {
    const response: PersistResponse = {
      id: request.id,
      success: false,
    };

    try {
      // Start transaction
      db.exec('BEGIN TRANSACTION');

      // Batch insert chunks
      for (const chunk of request.chunks) {
        const chunkId = `${request.id}-${chunk.index}`;
        const createdAt = new Date().toISOString();

        const stmt = db.prepare(
          `INSERT INTO stream_buffer_chunks 
           (id, session_id, chunk_index, chunk_type, chunk_text, version, timestamp, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
          chunkId,
          request.sessionId,
          chunk.index,
          chunk.type,
          chunk.text,
          chunk.version,
          chunk.timestamp,
          createdAt
        );
      }

      // Commit transaction
      db.exec('COMMIT');

      // Send success ACK
      response.success = true;
      if (parentPort) {
        parentPort.postMessage(response);
      }
    } catch (error) {
      // Rollback transaction on error
      db.exec('ROLLBACK');

      // Send error ACK
      response.error = error instanceof Error ? error.message : String(error);
      if (parentPort) {
        parentPort.postMessage(response);
      }
    }
  });
}
