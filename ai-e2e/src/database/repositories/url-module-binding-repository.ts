import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateURLModuleBindingParams {
  url_id: string;
  functional_module_id: string;
  status?: string;
  confidence_score?: number;
}

export interface URLModuleBinding {
  id: string;
  url_id: string;
  functional_module_id: string;
  status: string;
  confidence_score: number | null;
  created_at: string;
}

export class URLModuleBindingRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByModuleId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO url_module_bindings (id, url_id, functional_module_id, status, confidence_score) VALUES (?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM url_module_bindings WHERE id = ?');
    this.stmtFindByModuleId = db.prepare('SELECT * FROM url_module_bindings WHERE functional_module_id = ?');
    this.stmtDelete = db.prepare('DELETE FROM url_module_bindings WHERE id = ?');
  }

  create(params: CreateURLModuleBindingParams): URLModuleBinding {
    const id = generateId();
    this.stmtInsert.run(id, params.url_id, params.functional_module_id, params.status ?? 'ai_proposed', params.confidence_score ?? null);
    return this.findById(id) as URLModuleBinding;
  }

  findById(id: string): URLModuleBinding | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByModuleId(moduleId: string): URLModuleBinding[] {
    return (this.stmtFindByModuleId.all(moduleId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  findByProjectId(projectId: string): URLModuleBinding[] {
    return (this.db.prepare(
      'SELECT b.* FROM url_module_bindings b JOIN urls u ON b.url_id = u.id WHERE u.project_id = ?'
    ).all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  updateStatus(id: string, status: string): URLModuleBinding | null {
    this.db.prepare('UPDATE url_module_bindings SET status = ? WHERE id = ?').run(status, id);
    return this.findById(id);
  }

  findBindingStatusByModuleIds(moduleIds: string[]): Map<string, boolean> {
    if (moduleIds.length === 0) {
      return new Map();
    }

    const placeholders = moduleIds.map(() => '?').join(',');
    const query = `
      SELECT functional_module_id
      FROM url_module_bindings
      WHERE functional_module_id IN (${placeholders})
        AND status != 'rejected'
    `;

    const rows = this.db.prepare(query).all(...moduleIds) as Record<string, unknown>[];
    const boundModuleIds = new Set(rows.map(r => r.functional_module_id as string));

    const result = new Map<string, boolean>();
    for (const id of moduleIds) {
      result.set(id, boundModuleIds.has(id));
    }

    return result;
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): URLModuleBinding {
    return {
      id: row.id as string, url_id: row.url_id as string,
      functional_module_id: row.functional_module_id as string,
      status: row.status as string,
      confidence_score: row.confidence_score as number | null,
      created_at: row.created_at as string,
    };
  }
}
