import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateURLParams {
  project_id: string;
  url: string;
  title?: string;
  discovered_method?: string;
  page_snapshot_json?: string;
  auth_required?: boolean;
  last_verified_at?: string;
}

export interface URLRecord {
  id: string;
  project_id: string;
  url: string;
  title: string | null;
  discovered_method: string | null;
  page_snapshot_json: string | null;
  auth_required: number;
  last_verified_at: string | null;
  created_at: string;
}

export class URLRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByProjectId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO urls (id, project_id, url, title, discovered_method, page_snapshot_json, auth_required, last_verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM urls WHERE id = ?');
    this.stmtFindByProjectId = db.prepare('SELECT * FROM urls WHERE project_id = ? ORDER BY created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM urls WHERE id = ?');
  }

  create(params: CreateURLParams): URLRecord {
    const id = generateId();
    this.stmtInsert.run(
      id, params.project_id, params.url, params.title ?? null,
      params.discovered_method ?? null, params.page_snapshot_json ?? null,
      params.auth_required ? 1 : 0, params.last_verified_at ?? null
    );
    return this.findById(id) as URLRecord;
  }

  findById(id: string): URLRecord | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): URLRecord[] {
    return (this.stmtFindByProjectId.all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  findUnbound(projectId: string): URLRecord[] {
    return (this.db.prepare(
      'SELECT u.* FROM urls u LEFT JOIN url_module_bindings b ON u.id = b.url_id WHERE u.project_id = ? AND b.id IS NULL ORDER BY u.created_at ASC'
    ).all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): URLRecord {
    return {
      id: row.id as string, project_id: row.project_id as string,
      url: row.url as string, title: row.title as string | null,
      discovered_method: row.discovered_method as string | null,
      page_snapshot_json: row.page_snapshot_json as string | null,
      auth_required: row.auth_required as number,
      last_verified_at: row.last_verified_at as string | null,
      created_at: row.created_at as string,
    };
  }
}
