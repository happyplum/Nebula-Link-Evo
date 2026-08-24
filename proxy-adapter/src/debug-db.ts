import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CreateInteractionParams {
  readonly timestamp?: number;
  readonly snapshot_id?: string;
  readonly nebula_id?: number;
  readonly action_type: string;
  readonly target_type: string;
  readonly locator_strategy?: string;
  readonly success: boolean;
  readonly attempts?: number;
  readonly latency_ms?: number;
  readonly error_code?: string;
  readonly error_message?: string;
}

export interface QueryInteractionsOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly action_type?: string;
  readonly target_type?: string;
  readonly success?: boolean;
  readonly snapshot_id?: string;
  readonly nebula_id?: number;
  readonly start_time?: number;
  readonly end_time?: number;
  readonly locator_strategy?: string;
}

export interface Interaction {
  readonly id: number;
  readonly timestamp: number;
  readonly snapshot_id: string | null;
  readonly nebula_id: number | null;
  readonly action_type: string;
  readonly target_type: string;
  readonly locator_strategy: string | null;
  readonly success: boolean;
  readonly attempts: number | null;
  readonly latency_ms: number | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
}

export interface InteractionStats {
  readonly total: number;
  readonly success_count: number;
  readonly failure_count: number;
  readonly success_rate: number;
  readonly avg_latency_ms: number | null;
  readonly avg_attempts: number | null;
  readonly by_action_type: Record<string, number>;
  readonly by_target_type: Record<string, number>;
}

interface InteractionRow {
  readonly id: number;
  readonly timestamp: number;
  readonly snapshot_id: string | null;
  readonly nebula_id: number | null;
  readonly action_type: string;
  readonly target_type: string;
  readonly locator_strategy: string | null;
  readonly success: number;
  readonly attempts: number | null;
  readonly latency_ms: number | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
}

const DEFAULT_DEBUG_DB_PATH = join(process.cwd(), 'data', 'proxy-adapter', 'debug.sqlite');

export class DebugDatabaseManager {
  private static instance: DebugDatabaseManager | null = null;
  private db: DatabaseSync | null = null;

  static getInstance(): DebugDatabaseManager {
    if (!DebugDatabaseManager.instance) {
      DebugDatabaseManager.instance = new DebugDatabaseManager();
    }
    return DebugDatabaseManager.instance;
  }

  static resetInstance(): void {
    DebugDatabaseManager.instance?.close();
    DebugDatabaseManager.instance = null;
  }

  initialize(dbPath: string = DEFAULT_DEBUG_DB_PATH): void {
    if (this.db) {
      return;
    }

    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.createSchema();
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  insertInteraction(params: CreateInteractionParams): Interaction {
    const db = this.requireDb();
    const timestamp = params.timestamp ?? Date.now();
    const stmt = db.prepare(
      `INSERT INTO interactions (
        timestamp, snapshot_id, nebula_id, action_type, target_type,
        locator_strategy, success, attempts, latency_ms, error_code, error_message
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const result = stmt.run(
      timestamp,
      params.snapshot_id ?? null,
      params.nebula_id ?? null,
      params.action_type,
      params.target_type,
      params.locator_strategy ?? null,
      params.success ? 1 : 0,
      params.attempts ?? null,
      params.latency_ms ?? null,
      params.error_code ?? null,
      params.error_message ?? null
    );

    const row = db
      .prepare('SELECT * FROM interactions WHERE id = ?')
      .get(result.lastInsertRowid) as unknown as InteractionRow;
    return this.mapRowToInteraction(row);
  }

  queryInteractions(options: QueryInteractionsOptions = {}): Interaction[] {
    const db = this.requireDb();
    const conditions: string[] = [];
    const values: SQLInputValue[] = [];

    addCondition(conditions, values, 'action_type = ?', options.action_type);
    addCondition(conditions, values, 'target_type = ?', options.target_type);
    if (options.success !== undefined) {
      values.push(options.success ? 1 : 0);
      conditions.push('success = ?');
    }
    addCondition(conditions, values, 'snapshot_id = ?', options.snapshot_id);
    addCondition(conditions, values, 'nebula_id = ?', options.nebula_id);
    addCondition(conditions, values, 'timestamp >= ?', options.start_time);
    addCondition(conditions, values, 'timestamp <= ?', options.end_time);
    addCondition(conditions, values, 'locator_strategy = ?', options.locator_strategy);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    let sql = `SELECT * FROM interactions ${whereClause} ORDER BY timestamp DESC`;
    if (options.limit !== undefined) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }
    if (options.offset !== undefined) {
      sql += ' OFFSET ?';
      values.push(options.offset);
    }

    const rows = db.prepare(sql).all(...values) as unknown as InteractionRow[];
    return rows.map((row) => this.mapRowToInteraction(row));
  }

  getStats(): InteractionStats {
    const db = this.requireDb();
    const total = (
      db.prepare('SELECT COUNT(*) as count FROM interactions').get() as { count: number }
    ).count;
    const successCount = (
      db.prepare('SELECT COUNT(*) as count FROM interactions WHERE success = 1').get() as {
        count: number;
      }
    ).count;
    const latency = db
      .prepare('SELECT AVG(latency_ms) as avg FROM interactions WHERE latency_ms IS NOT NULL')
      .get() as { avg: number | null };
    const attempts = db
      .prepare('SELECT AVG(attempts) as avg FROM interactions WHERE attempts IS NOT NULL')
      .get() as { avg: number | null };

    return {
      total,
      success_count: successCount,
      failure_count: total - successCount,
      success_rate: total > 0 ? (successCount / total) * 100 : 0,
      avg_latency_ms: latency.avg,
      avg_attempts: attempts.avg,
      by_action_type: countBy(db, 'action_type'),
      by_target_type: countBy(db, 'target_type'),
    };
  }

  private createSchema(): void {
    const db = this.requireDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        snapshot_id TEXT,
        nebula_id INTEGER,
        action_type TEXT NOT NULL,
        target_type TEXT NOT NULL,
        locator_strategy TEXT,
        success INTEGER NOT NULL,
        attempts INTEGER,
        latency_ms INTEGER,
        error_code TEXT,
        error_message TEXT
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_interactions_timestamp ON interactions(timestamp)');
  }

  private requireDb(): DatabaseSync {
    if (!this.db) {
      this.initialize();
    }
    if (!this.db) {
      throw new Error('Debug database not initialized');
    }
    return this.db;
  }

  private mapRowToInteraction(row: InteractionRow): Interaction {
    return {
      id: row.id,
      timestamp: row.timestamp,
      snapshot_id: row.snapshot_id,
      nebula_id: row.nebula_id,
      action_type: row.action_type,
      target_type: row.target_type,
      locator_strategy: row.locator_strategy,
      success: row.success === 1,
      attempts: row.attempts,
      latency_ms: row.latency_ms,
      error_code: row.error_code,
      error_message: row.error_message,
    };
  }
}

function addCondition(
  conditions: string[],
  values: SQLInputValue[],
  clause: string,
  value: SQLInputValue | undefined
): void {
  if (value !== undefined) {
    conditions.push(clause);
    values.push(value);
  }
}

function countBy(db: DatabaseSync, column: 'action_type' | 'target_type'): Record<string, number> {
  const rows = db
    .prepare(`SELECT ${column}, COUNT(*) as count FROM interactions GROUP BY ${column}`)
    .all() as Array<{
    readonly [key: string]: string | number;
    readonly count: number;
  }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = row[column];
    if (typeof key === 'string') {
      result[key] = row.count;
    }
  }
  return result;
}
