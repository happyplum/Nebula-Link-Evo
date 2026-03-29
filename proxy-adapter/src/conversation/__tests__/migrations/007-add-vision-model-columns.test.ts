import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { up, down } from '../../migrations/007-add-vision-model-columns.js';

function createSessionsTable(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      summary TEXT,
      message_count INTEGER DEFAULT 0,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'paused', 'blocked', 'interrupted', 'cancelled', 'completed'))
    )
  `);
}

function columnExists(db: DatabaseSync, tableName: string, columnName: string): boolean {
  const result = db.prepare(
    `SELECT COUNT(*) as count FROM pragma_table_info(?) WHERE name = ?`
  ).get(tableName, columnName) as { count: number };
  return result.count > 0;
}

describe('007-add-vision-model-columns migration', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    createSessionsTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should add vision_provider and vision_model columns to sessions table', () => {
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(false);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(false);

    up(db);

    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);
  });

  it('should be idempotent - running twice should not error', () => {
    up(db);
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);

    // Running again should not throw
    expect(() => up(db)).not.toThrow();
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);
  });

  it('should drop vision_provider and vision_model columns in down()', () => {
    up(db);
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);

    down(db);
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(false);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(false);
  });

  it('should allow NULL values for new columns', () => {
    up(db);

    const insertStmt = db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, provider, model)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertStmt.run('test-id', 'Test Session', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'test-provider', 'test-model');

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-id') as Record<string, unknown>;
    expect(row.vision_provider).toBeNull();
    expect(row.vision_model).toBeNull();
  });
});
