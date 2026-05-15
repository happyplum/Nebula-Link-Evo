import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreateAIInterventionLogParams {
  execution_run_id: string;
  diagnosis?: string;
  failure_type?: string;
  action_taken?: string;
  original_script_snapshot?: string;
  modified_script_snapshot?: string;
  diagnosis_tokens?: number;
  outcome?: string;
}

export interface AIInterventionLog {
  id: string;
  execution_run_id: string;
  diagnosis: string | null;
  failure_type: string | null;
  action_taken: string | null;
  original_script_snapshot: string | null;
  modified_script_snapshot: string | null;
  diagnosis_tokens: number | null;
  outcome: string | null;
  created_at: string;
}

export class AIInterventionLogRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByRunId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO ai_intervention_logs (id, execution_run_id, diagnosis, failure_type, action_taken, original_script_snapshot, modified_script_snapshot, diagnosis_tokens, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM ai_intervention_logs WHERE id = ?');
    this.stmtFindByRunId = db.prepare('SELECT * FROM ai_intervention_logs WHERE execution_run_id = ? ORDER BY created_at ASC');
    this.stmtDelete = db.prepare('DELETE FROM ai_intervention_logs WHERE id = ?');
  }

  create(params: CreateAIInterventionLogParams): AIInterventionLog {
    const id = generateId();
    this.stmtInsert.run(
      id, params.execution_run_id, params.diagnosis ?? null, params.failure_type ?? null, params.action_taken ?? null,
      params.original_script_snapshot ?? null, params.modified_script_snapshot ?? null,
      params.diagnosis_tokens ?? null, params.outcome ?? null
    );
    return this.findById(id) as AIInterventionLog;
  }

  findById(id: string): AIInterventionLog | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByRunId(runId: string): AIInterventionLog[] {
    return (this.stmtFindByRunId.all(runId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): AIInterventionLog {
    return {
      id: row.id as string, execution_run_id: row.execution_run_id as string,
      diagnosis: row.diagnosis as string | null,
      failure_type: row.failure_type as string | null,
      action_taken: row.action_taken as string | null,
      original_script_snapshot: row.original_script_snapshot as string | null,
      modified_script_snapshot: row.modified_script_snapshot as string | null,
      diagnosis_tokens: row.diagnosis_tokens as number | null,
      outcome: row.outcome as string | null,
      created_at: row.created_at as string,
    };
  }
}
