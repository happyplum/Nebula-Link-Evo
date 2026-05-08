import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateExplorationSessionParams {
  project_id: string;
  pages_visited_json?: string;
  urls_discovered_json?: string;
  strategy_used?: string;
  token_count?: number;
}

export interface ExplorationSession {
  id: string;
  project_id: string;
  started_at: string;
  completed_at: string | null;
  pages_visited_json: string | null;
  urls_discovered_json: string | null;
  strategy_used: string | null;
  token_count: number | null;
  created_at: string;
}

export interface UpdateExplorationSessionParams {
  completed_at?: string;
  pages_visited_json?: string;
  urls_discovered_json?: string;
  token_count?: number;
}

export class ExplorationSessionRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByProjectId: Database.Statement;
  private stmtFindLatest: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO exploration_sessions (id, project_id, pages_visited_json, urls_discovered_json, strategy_used, token_count) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM exploration_sessions WHERE id = ?');
    this.stmtFindByProjectId = db.prepare('SELECT * FROM exploration_sessions WHERE project_id = ? ORDER BY started_at DESC');
    this.stmtFindLatest = db.prepare('SELECT * FROM exploration_sessions WHERE project_id = ? ORDER BY started_at DESC LIMIT 1');
    this.stmtDelete = db.prepare('DELETE FROM exploration_sessions WHERE id = ?');
  }

  create(params: CreateExplorationSessionParams): ExplorationSession {
    const id = generateId();
    this.stmtInsert.run(
      id, params.project_id, params.pages_visited_json ?? null,
      params.urls_discovered_json ?? null, params.strategy_used ?? null, params.token_count ?? null
    );
    return this.findById(id) as ExplorationSession;
  }

  findById(id: string): ExplorationSession | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): ExplorationSession[] {
    return (this.stmtFindByProjectId.all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  findLatest(projectId: string): ExplorationSession | null {
    const row = this.stmtFindLatest.get(projectId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  update(id: string, params: UpdateExplorationSessionParams): ExplorationSession | null {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (params.completed_at !== undefined) {
      sets.push('completed_at = ?');
      values.push(params.completed_at);
    }
    if (params.pages_visited_json !== undefined) {
      sets.push('pages_visited_json = ?');
      values.push(params.pages_visited_json);
    }
    if (params.urls_discovered_json !== undefined) {
      sets.push('urls_discovered_json = ?');
      values.push(params.urls_discovered_json);
    }
    if (params.token_count !== undefined) {
      sets.push('token_count = ?');
      values.push(params.token_count);
    }

    if (sets.length === 0) return this.findById(id);

    values.push(id);
    this.db.prepare(`UPDATE exploration_sessions SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): ExplorationSession {
    return {
      id: row.id as string, project_id: row.project_id as string,
      started_at: row.started_at as string, completed_at: row.completed_at as string | null,
      pages_visited_json: row.pages_visited_json as string | null,
      urls_discovered_json: row.urls_discovered_json as string | null,
      strategy_used: row.strategy_used as string | null,
      token_count: row.token_count as number | null,
      created_at: row.created_at as string,
    };
  }
}
