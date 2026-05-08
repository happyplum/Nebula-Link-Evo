import Database from 'better-sqlite3';
import { generateId } from '../db.js';

export interface CreatePRDDocumentParams {
  project_id: string;
  raw_content: string;
  format?: string;
  parsed_content_json?: string;
  ai_model_used?: string;
  token_count?: number;
}

export interface UpdatePRDDocumentParams {
  raw_content?: string;
  format?: string;
  parsed_content_json?: string | null;
  ai_model_used?: string | null;
  token_count?: number | null;
}

export interface PRDDocument {
  id: string;
  project_id: string;
  raw_content: string;
  format: string;
  parsed_content_json: string | null;
  ai_model_used: string | null;
  token_count: number | null;
  created_at: string;
}

export class PRDDocumentRepository {
  private stmtInsert: Database.Statement;
  private stmtFindById: Database.Statement;
  private stmtFindByProjectId: Database.Statement;
  private stmtDelete: Database.Statement;

  constructor(private db: Database.Database) {
    this.stmtInsert = db.prepare(
      'INSERT INTO prd_documents (id, project_id, raw_content, format, parsed_content_json, ai_model_used, token_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    this.stmtFindById = db.prepare('SELECT * FROM prd_documents WHERE id = ?');
    this.stmtFindByProjectId = db.prepare('SELECT * FROM prd_documents WHERE project_id = ? ORDER BY created_at DESC');
    this.stmtDelete = db.prepare('DELETE FROM prd_documents WHERE id = ?');
  }

  create(params: CreatePRDDocumentParams): PRDDocument {
    const id = generateId();
    this.stmtInsert.run(
      id, params.project_id, params.raw_content, params.format ?? 'markdown',
      params.parsed_content_json ?? null, params.ai_model_used ?? null, params.token_count ?? null
    );
    return this.findById(id) as PRDDocument;
  }

  findById(id: string): PRDDocument | null {
    const row = this.stmtFindById.get(id) as Record<string, unknown> | undefined;
    return row ? this.mapRow(row) : null;
  }

  findByProjectId(projectId: string): PRDDocument[] {
    return (this.stmtFindByProjectId.all(projectId) as Record<string, unknown>[]).map(r => this.mapRow(r));
  }

  update(id: string, params: UpdatePRDDocumentParams): PRDDocument | null {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (params.raw_content !== undefined) { updates.push('raw_content = ?'); values.push(params.raw_content); }
    if (params.format !== undefined) { updates.push('format = ?'); values.push(params.format); }
    if (params.parsed_content_json !== undefined) { updates.push('parsed_content_json = ?'); values.push(params.parsed_content_json); }
    if (params.ai_model_used !== undefined) { updates.push('ai_model_used = ?'); values.push(params.ai_model_used); }
    if (params.token_count !== undefined) { updates.push('token_count = ?'); values.push(params.token_count); }
    if (updates.length === 0) return this.findById(id);
    values.push(id);
    this.db.prepare('UPDATE prd_documents SET ' + updates.join(', ') + ' WHERE id = ?').run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.stmtDelete.run(id).changes > 0;
  }

  private mapRow(row: Record<string, unknown>): PRDDocument {
    return {
      id: row.id as string, project_id: row.project_id as string,
      raw_content: row.raw_content as string, format: row.format as string,
      parsed_content_json: row.parsed_content_json as string | null,
      ai_model_used: row.ai_model_used as string | null,
      token_count: row.token_count as number | null,
      created_at: row.created_at as string,
    };
  }
}
