import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateLoginScriptParams {
  project_id: string;
  name: string;
  steps_json: string;
}

export interface UpdateLoginScriptParams {
  name?: string;
  steps_json?: string;
}

export interface LoginScript {
  id: string;
  project_id: string;
  name: string;
  steps_json: string;
  created_at: string;
}

export class LoginScriptRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByProjectId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO login_scripts (id, project_id, name, steps_json) VALUES (?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM login_scripts WHERE id = ?');
    this.stmtFindByProjectId = db.prepare('SELECT * FROM login_scripts WHERE project_id = ? ORDER BY created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM login_scripts WHERE id = ?');
  }

  create(params: CreateLoginScriptParams): LoginScript {
    const id = generateId();
    this.stmtInsert.run(id, params.project_id, params.name, params.steps_json);
    return this.findById(id) as LoginScript;
  }

  findById(id: string): LoginScript | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): LoginScript[] {
    return (this.stmtFindByProjectId.all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  update(id: string, params: UpdateLoginScriptParams): LoginScript | null {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (params.name !== undefined) { updates.push('name = ?'); values.push(params.name); }
    if (params.steps_json !== undefined) { updates.push('steps_json = ?'); values.push(params.steps_json); }
    if (updates.length === 0) return this.findById(id);
    values.push(id);
    this.db.prepare('UPDATE login_scripts SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): LoginScript {
    return {
      id: row.id as string, project_id: row.project_id as string,
      name: row.name as string, steps_json: row.steps_json as string,
      created_at: row.created_at as string,
    };
  }
}
