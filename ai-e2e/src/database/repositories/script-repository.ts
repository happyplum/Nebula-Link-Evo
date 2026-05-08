import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateScriptParams {
  test_scenario_id: string;
  version?: number;
  content: string;
  language?: string;
  generated_by?: string;
  status?: string;
}

export interface Script {
  id: string;
  test_scenario_id: string;
  version: number;
  content: string;
  language: string;
  generated_by: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export class ScriptRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByScenarioId: Database.Statement;
  private stmtFindLatest: Database.Statement;
  private stmtFindByStatus: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO scripts (id, test_scenario_id, version, content, language, generated_by, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM scripts WHERE id = ?');
    this.stmtFindByScenarioId = db.prepare('SELECT * FROM scripts WHERE test_scenario_id = ? ORDER BY version DESC');
    this.stmtFindLatest = db.prepare('SELECT * FROM scripts WHERE test_scenario_id = ? ORDER BY version DESC LIMIT 1');
    this.stmtFindByStatus = db.prepare('SELECT * FROM scripts WHERE status = ? ORDER BY created_at DESC');
    this.stmtDelete = db.prepare('DELETE FROM scripts WHERE id = ?');
  }

  create(params: CreateScriptParams): Script {
    const id = generateId();
    this.stmtInsert.run(
      id, params.test_scenario_id, params.version ?? 1, params.content,
      params.language ?? 'ts', params.generated_by ?? 'ai_generated', params.status ?? 'generated'
    );
    return this.findById(id) as Script;
  }

  findById(id: string): Script | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByScenarioId(scenarioId: string): Script[] {
    return (this.stmtFindByScenarioId.all(scenarioId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  findLatestByScenarioId(scenarioId: string): Script | null {
    const row = this.stmtFindLatest.get(scenarioId) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByStatus(status: string): Script[] {
    return (this.stmtFindByStatus.all(status) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  createVersion(scenarioId: string, content: string, generatedBy: string): Script {
    const latest = this.findLatestByScenarioId(scenarioId);
    const nextVersion = latest ? latest.version + 1 : 1;
    return this.create({ test_scenario_id: scenarioId, content, version: nextVersion, generated_by: generatedBy });
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): Script {
    return {
      id: row.id as string, test_scenario_id: row.test_scenario_id as string,
      version: row.version as number, content: row.content as string,
      language: row.language as string, generated_by: row.generated_by as string,
      status: row.status as string, created_at: row.created_at as string,
      updated_at: row.updated_at as string,
    };
  }
}
