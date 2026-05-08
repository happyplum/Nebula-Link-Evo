import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateBusinessModuleParams {
  project_id: string;
  name: string;
  description?: string;
  sort_order?: number;
  source?: string;
}

export interface BusinessModule {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  source: string;
  created_at: string;
}

export class BusinessModuleRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByProjectId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO business_modules (id, project_id, name, description, sort_order, source) VALUES (?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM business_modules WHERE id = ?');
    this.stmtFindByProjectId = db.prepare('SELECT * FROM business_modules WHERE project_id = ? ORDER BY sort_order ASC, created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM business_modules WHERE id = ?');
  }

  create(params: CreateBusinessModuleParams): BusinessModule {
    const id = generateId();
    this.stmtInsert.run(
      id, params.project_id, params.name, params.description ?? null,
      params.sort_order ?? 0, params.source ?? 'ai_generated'
    );
    return this.findById(id) as BusinessModule;
  }

  findById(id: string): BusinessModule | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): BusinessModule[] {
    return (this.stmtFindByProjectId.all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  reorder(ids: string[]): void {
    const stmt = this.db.prepare('UPDATE business_modules SET sort_order = ? WHERE id = ?');
    this.db.transaction(() => {
      for (let i = 0; i < ids.length; i++) {
        stmt.run(i, ids[i]);
      }
    })();
  }

  private mapRow(row: Record<string, unknown>): BusinessModule {
    return {
      id: row.id as string, project_id: row.project_id as string,
      name: row.name as string, description: row.description as string | null,
      sort_order: row.sort_order as number, source: row.source as string,
      created_at: row.created_at as string,
    };
  }
}
