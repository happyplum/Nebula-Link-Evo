import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateProjectParams {
  name: string;
  target_base_url?: string;
  auth_config_json?: string;
  status?: string;
}

export interface UpdateProjectParams {
  name?: string;
  target_base_url?: string | null;
  auth_config_json?: string | null;
  status?: string;
}

export interface Project {
  id: string;
  name: string;
  target_base_url: string | null;
  auth_config_json: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class ProjectRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindAll: Database.Statement;
  private stmtDelete: Database.Statement;
  private stmtFindByStatus: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      `INSERT INTO projects (id, name, target_base_url, auth_config_json, status) VALUES (?, ?, ?, ?, ?)`
    );
    this.stmtFindById = db.prepare('SELECT * FROM projects WHERE id = ?');
    this.stmtFindAll = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
    this.stmtDelete = db.prepare('DELETE FROM projects WHERE id = ?');
    this.stmtFindByStatus = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC');
  }

  create(params: CreateProjectParams): Project {
    const id = generateId();
    this.stmtInsert.run(id, params.name, params.target_base_url ?? null, params.auth_config_json ?? null, params.status ?? 'draft');
    return this.findById(id) as Project;
  }

  findById(id: string): Project | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findAll(): Project[] {
    return (this.stmtFindAll.all() as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  update(id: string, params: UpdateProjectParams): Project | null {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (params.name !== undefined) { updates.push('name = ?'); values.push(params.name); }
    if (params.target_base_url !== undefined) { updates.push('target_base_url = ?'); values.push(params.target_base_url); }
    if (params.auth_config_json !== undefined) { updates.push('auth_config_json = ?'); values.push(params.auth_config_json); }
    if (params.status !== undefined) { updates.push('status = ?'); values.push(params.status); }
    if (updates.length === 0) return this.findById(id);
    updates.push("updated_at = datetime('now')");
    values.push(id);
    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean { return this.stmtDelete.run(id).changes > 0; }
  findByStatus(status: string): Project[] { return (this.stmtFindByStatus.all(status) as Record<string, unknown>[]).map(r => this.mapRow(r)); }
  updateStatus(id: string, status: string): Project | null {
    this.db.prepare("UPDATE projects SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    return this.findById(id);
  }

  private mapRow(row: Record<string, unknown>): Project {
    return { id: row.id as string, name: row.name as string, target_base_url: row.target_base_url as string | null, auth_config_json: row.auth_config_json as string | null, status: row.status as string, created_at: row.created_at as string, updated_at: row.updated_at as string };
  }
}
