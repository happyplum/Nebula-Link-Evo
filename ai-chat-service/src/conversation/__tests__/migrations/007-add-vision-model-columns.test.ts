import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { down, up } from '../../migrations/007-add-vision-model-columns.js';

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
    'SELECT COUNT(*) as count FROM pragma_table_info(?) WHERE name = ?'
  ).get(tableName, columnName) as { readonly count: number };
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

  it('adds vision_provider and vision_model columns to sessions table', () => {
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(false);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(false);

    up(db);

    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);
  });

  it('is idempotent when run twice', () => {
    up(db);

    expect(() => up(db)).not.toThrow();
    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(true);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(true);
  });

  it('drops vision_provider and vision_model columns in down()', () => {
    up(db);

    down(db);

    expect(columnExists(db, 'sessions', 'vision_provider')).toBe(false);
    expect(columnExists(db, 'sessions', 'vision_model')).toBe(false);
  });

  it('allows null values for new columns', () => {
    up(db);

    const insertStmt = db.prepare(
      `INSERT INTO sessions (id, title, created_at, updated_at, provider, model)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertStmt.run('test-id', 'Test Session', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z', 'test-provider', 'test-model');

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('test-id') as {
      readonly vision_provider: string | null;
      readonly vision_model: string | null;
    };
    expect(row.vision_provider).toBeNull();
    expect(row.vision_model).toBeNull();
  });
});
