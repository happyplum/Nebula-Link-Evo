import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateExecutionRunParams {
  script_id: string;
  script_version?: number;
  status?: string;
  logs?: string;
  screenshot_paths_json?: string;
  error_message?: string;
}

export interface UpdateExecutionRunParams {
  status?: string;
  completed_at?: string;
  logs?: string;
  screenshot_paths_json?: string;
  error_message?: string;
}

export interface ExecutionRun {
  id: string;
  script_id: string;
  script_version: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  logs: string | null;
  screenshot_paths_json: string | null;
  error_message: string | null;
  created_at: string;
}

export class ExecutionRunRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByScriptId: Database.Statement;
  private stmtFindLatest: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO execution_runs (id, script_id, script_version, status, logs, screenshot_paths_json, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM execution_runs WHERE id = ?');
    this.stmtFindByScriptId = db.prepare('SELECT * FROM execution_runs WHERE script_id = ? ORDER BY started_at DESC');
    this.stmtFindLatest = db.prepare('SELECT * FROM execution_runs WHERE script_id = ? ORDER BY started_at DESC LIMIT 1');
    this.stmtDelete = db.prepare('DELETE FROM execution_runs WHERE id = ?');
  }

  create(params: CreateExecutionRunParams): ExecutionRun {
    const id = generateId();
    this.stmtInsert.run(
      id, params.script_id, params.script_version ?? 1, params.status ?? 'running',
      params.logs ?? null, params.screenshot_paths_json ?? null, params.error_message ?? null
    );
    return this.findById(id) as ExecutionRun;
  }

  findById(id: string): ExecutionRun | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByScriptId(scriptId: string): ExecutionRun[] {
    return (this.stmtFindByScriptId.all(scriptId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  findLatest(scriptId: string): ExecutionRun | null {
    const row = this.stmtFindLatest.get(scriptId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  update(id: string, params: UpdateExecutionRunParams): ExecutionRun | null {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (params.status !== undefined) { updates.push('status = ?'); values.push(params.status); }
    if (params.completed_at !== undefined) { updates.push('completed_at = ?'); values.push(params.completed_at); }
    if (params.logs !== undefined) { updates.push('logs = ?'); values.push(params.logs); }
    if (params.screenshot_paths_json !== undefined) { updates.push('screenshot_paths_json = ?'); values.push(params.screenshot_paths_json); }
    if (params.error_message !== undefined) { updates.push('error_message = ?'); values.push(params.error_message); }
    if (updates.length === 0) return this.findById(id);
    values.push(id);
    this.db.prepare('UPDATE execution_runs SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): ExecutionRun {
    return {
      id: row.id as string, script_id: row.script_id as string,
      script_version: row.script_version as number,
      started_at: row.started_at as string, completed_at: row.completed_at as string | null,
      status: row.status as string, logs: row.logs as string | null,
      screenshot_paths_json: row.screenshot_paths_json as string | null,
      error_message: row.error_message as string | null,
      created_at: row.created_at as string,
    };
  }
}
