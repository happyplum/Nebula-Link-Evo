import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateFunctionalModuleParams {
  business_module_id: string;
  name: string;
  description?: string;
  sort_order?: number;
  bound_url_id?: string;
  source?: string;
}

export interface FunctionalModule {
  id: string;
  business_module_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  bound_url_id: string | null;
  source: string;
  created_at: string;
}

export class FunctionalModuleRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByBusinessModuleId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO functional_modules (id, business_module_id, name, description, sort_order, bound_url_id, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM functional_modules WHERE id = ?');
    this.stmtFindByBusinessModuleId = db.prepare('SELECT * FROM functional_modules WHERE business_module_id = ? ORDER BY sort_order ASC, created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM functional_modules WHERE id = ?');
  }

  create(params: CreateFunctionalModuleParams): FunctionalModule {
    const id = generateId();
    this.stmtInsert.run(
      id, params.business_module_id, params.name, params.description ?? null,
      params.sort_order ?? 0, params.bound_url_id ?? null, params.source ?? 'ai_generated'
    );
    return this.findById(id) as FunctionalModule;
  }

  findById(id: string): FunctionalModule | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByBusinessModuleId(businessModuleId: string): FunctionalModule[] {
    return (this.stmtFindByBusinessModuleId.all(businessModuleId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  updateBoundUrl(id: string, urlId: string | null): FunctionalModule | null {
    this.db.prepare('UPDATE functional_modules SET bound_url_id = ? WHERE id = ?').run(urlId, id);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): FunctionalModule {
    return {
      id: row.id as string, business_module_id: row.business_module_id as string,
      name: row.name as string, description: row.description as string | null,
      sort_order: row.sort_order as number, bound_url_id: row.bound_url_id as string | null,
      source: row.source as string, created_at: row.created_at as string,
    };
  }
}
