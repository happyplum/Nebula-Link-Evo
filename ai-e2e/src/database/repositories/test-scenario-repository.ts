import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateTestScenarioParams {
  functional_module_id: string;
  name: string;
  description?: string;
  test_data_json?: string;
  sort_order?: number;
  source?: string;
}

export interface UpdateTestScenarioData {
  name?: string;
  description?: string;
  test_data_json?: string;
  source?: string;
}

export interface TestScenario {
  id: string;
  functional_module_id: string;
  name: string;
  description: string | null;
  test_data_json: string | null;
  sort_order: number;
  source: string;
  created_at: string;
}

export class TestScenarioRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByFunctionalModuleId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO test_scenarios (id, functional_module_id, name, description, test_data_json, sort_order, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM test_scenarios WHERE id = ?');
    this.stmtFindByFunctionalModuleId = db.prepare('SELECT * FROM test_scenarios WHERE functional_module_id = ? ORDER BY sort_order ASC, created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM test_scenarios WHERE id = ?');
  }

  create(params: CreateTestScenarioParams): TestScenario {
    const id = generateId();
    this.stmtInsert.run(
      id, params.functional_module_id, params.name, params.description ?? null,
      params.test_data_json ?? null, params.sort_order ?? 0, params.source ?? 'ai_generated'
    );
    return this.findById(id) as TestScenario;
  }

  findById(id: string): TestScenario | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByFunctionalModuleId(functionalModuleId: string): TestScenario[] {
    return (this.stmtFindByFunctionalModuleId.all(functionalModuleId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  update(id: string, data: UpdateTestScenarioData): TestScenario | null {
    const updates: string[] = [];
    const values: unknown[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.description !== undefined) {
      updates.push('description = ?');
      values.push(data.description);
    }
    if (data.test_data_json !== undefined) {
      updates.push('test_data_json = ?');
      values.push(data.test_data_json);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push('source = ?');
    values.push('human_modified');
    values.push(id);

    const sql = `UPDATE test_scenarios SET ${updates.join(', ')} WHERE id = ?`;
    const result = this.db.prepare(sql).run(...values);

    if (result.changes === 0) {
      return null;
    }

    return this.findById(id);
  }

  private mapRow(row: Record<string, unknown>): TestScenario {
    return {
      id: row.id as string, functional_module_id: row.functional_module_id as string,
      name: row.name as string, description: row.description as string | null,
      test_data_json: row.test_data_json as string | null,
      sort_order: row.sort_order as number, source: row.source as string,
      created_at: row.created_at as string,
    };
  }
}
