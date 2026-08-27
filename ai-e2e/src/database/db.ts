import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { up as migrate001 } from './migrations/001-projects.js';
import { up as migrate014 } from './migrations/014-semantic-asset-foundation.js';
import {
  migrationId as migration015Id,
  migrationName as migration015Name,
  migrationSql as migration015Sql,
} from './migrations/015-semantic-asset-governance.js';
import {
  migrationId as migration016Id,
  migrationName as migration016Name,
  migrationSql as migration016Sql,
} from './migrations/016-semantic-workflow-foundation.js';
import {
  migrationId as migration017Id,
  migrationName as migration017Name,
  migrationSql as migration017Sql,
} from './migrations/017-semantic-evidence-integration-foundation.js';
import {
  migrationId as migration018Id,
  migrationName as migration018Name,
  migrationSql as migration018Sql,
} from './migrations/018-authoring-amendments.js';
import {
  migrationId as migration019Id,
  migrationName as migration019Name,
  migrationSql as migration019Sql,
} from './migrations/019-semantic-evidence-retention.js';
import {
  migrationId as migration020Id,
  migrationName as migration020Name,
  migrationSql as migration020Sql,
} from './migrations/020-agent-activity.js';
import { runTrackedMigration } from './migration-runner.js';
import { BusinessVersionRepository } from './repositories/business-version-repository.js';
import { SemanticAssetRepository } from './repositories/semantic-asset-repository.js';
import { SemanticEvidenceRepository } from './repositories/semantic-evidence-repository.js';
import { SemanticWorkflowRepository } from './repositories/semantic-workflow-repository.js';
import { SemanticQueryRepository } from './repositories/semantic-query-repository.js';
import { AuthoringAmendmentRepository } from './repositories/authoring-amendment-repository.js';
import { SemanticRunControlRepository } from './repositories/semantic-run-control-repository.js';
import { SemanticCoordinatorRepository } from './repositories/semantic-coordinator-repository.js';
import { SemanticProjectRepository } from './repositories/semantic-project-repository.js';
import { AgentActivityRepository } from './repositories/agent-activity-repository.js';

export function generateId(): string {
  return randomBytes(8).toString('hex');
}

class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private isInitialized = false;

  private semanticProjectRepo: SemanticProjectRepository | null = null;
  private businessVersionRepo: BusinessVersionRepository | null = null;
  private semanticAssetRepo: SemanticAssetRepository | null = null;
  private semanticWorkflowRepo: SemanticWorkflowRepository | null = null;
  private semanticEvidenceRepo: SemanticEvidenceRepository | null = null;
  private semanticQueryRepo: SemanticQueryRepository | null = null;
  private authoringAmendmentRepo: AuthoringAmendmentRepository | null = null;
  private semanticRunControlRepo: SemanticRunControlRepository | null = null;
  private semanticCoordinatorRepo: SemanticCoordinatorRepository | null = null;
  private agentActivityRepo: AgentActivityRepository | null = null;

  private constructor() {}

  static getInstance(): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager();
    }
    return DatabaseManager.instance;
  }

  static resetInstance(): void {
    if (DatabaseManager.instance) {
      try {
        DatabaseManager.instance.close();
      } catch {
        // Ignore errors during reset
      }
      DatabaseManager.instance = null;
    }
  }

  init(dbPath: string = ':memory:'): void {
    if (this.isInitialized && this.db) {
      return;
    }
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.runMigrations();
    this.initRepositories();
    this.isInitialized = true;
  }

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not initialized');
    migrate001(this.db);
    migrate014(this.db);
    for (const migration of [
      { id: migration015Id, name: migration015Name, sql: migration015Sql },
      { id: migration016Id, name: migration016Name, sql: migration016Sql },
      { id: migration017Id, name: migration017Name, sql: migration017Sql },
      { id: migration018Id, name: migration018Name, sql: migration018Sql },
      { id: migration019Id, name: migration019Name, sql: migration019Sql },
      { id: migration020Id, name: migration020Name, sql: migration020Sql },
    ]) {
      runTrackedMigration(this.db, migration, '1.0.0');
    }
    this.db
      .prepare(
        `INSERT OR IGNORE INTO browser_job_queue_meta (key, next_queue_seq)
       SELECT 'global', COALESCE(MAX(queue_seq), 0) + 1 FROM browser_jobs`
      )
      .run();
  }

  private initRepositories(): void {
    if (!this.db) throw new Error('Database not initialized');
    this.semanticProjectRepo = new SemanticProjectRepository(this.db);
    this.businessVersionRepo = new BusinessVersionRepository(this.db);
    this.semanticAssetRepo = new SemanticAssetRepository(this.db);
    this.semanticWorkflowRepo = new SemanticWorkflowRepository(this.db);
    this.semanticEvidenceRepo = new SemanticEvidenceRepository(this.db);
    this.semanticQueryRepo = new SemanticQueryRepository(this.db, this.businessVersionRepo);
    this.authoringAmendmentRepo = new AuthoringAmendmentRepository(this.db, this.semanticAssetRepo);
    this.semanticRunControlRepo = new SemanticRunControlRepository(
      this.db,
      this.semanticWorkflowRepo,
      this.semanticEvidenceRepo
    );
    this.semanticCoordinatorRepo = new SemanticCoordinatorRepository(this.db);
    this.agentActivityRepo = new AgentActivityRepository(this.db);
  }

  getDatabase(): Database.Database {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isInitialized = false;
      this.semanticProjectRepo = null;
      this.businessVersionRepo = null;
      this.semanticAssetRepo = null;
      this.semanticWorkflowRepo = null;
      this.semanticEvidenceRepo = null;
      this.semanticQueryRepo = null;
      this.authoringAmendmentRepo = null;
      this.semanticRunControlRepo = null;
      this.semanticCoordinatorRepo = null;
      this.agentActivityRepo = null;
    }
  }

  getSemanticProjectRepo(): SemanticProjectRepository {
    if (!this.semanticProjectRepo) throw new Error('Database not initialized');
    return this.semanticProjectRepo;
  }
  getBusinessVersionRepo(): BusinessVersionRepository {
    if (!this.businessVersionRepo) throw new Error('Database not initialized');
    return this.businessVersionRepo;
  }
  getSemanticAssetRepo(): SemanticAssetRepository {
    if (!this.semanticAssetRepo) throw new Error('Database not initialized');
    return this.semanticAssetRepo;
  }
  getSemanticWorkflowRepo(): SemanticWorkflowRepository {
    if (!this.semanticWorkflowRepo) throw new Error('Database not initialized');
    return this.semanticWorkflowRepo;
  }
  getSemanticEvidenceRepo(): SemanticEvidenceRepository {
    if (!this.semanticEvidenceRepo) throw new Error('Database not initialized');
    return this.semanticEvidenceRepo;
  }
  getSemanticQueryRepo(): SemanticQueryRepository {
    if (!this.semanticQueryRepo) throw new Error('Database not initialized');
    return this.semanticQueryRepo;
  }
  getAuthoringAmendmentRepo(): AuthoringAmendmentRepository {
    if (!this.authoringAmendmentRepo) throw new Error('Database not initialized');
    return this.authoringAmendmentRepo;
  }
  getSemanticRunControlRepo(): SemanticRunControlRepository {
    if (!this.semanticRunControlRepo) throw new Error('Database not initialized');
    return this.semanticRunControlRepo;
  }
  getSemanticCoordinatorRepo(): SemanticCoordinatorRepository {
    if (!this.semanticCoordinatorRepo) throw new Error('Database not initialized');
    return this.semanticCoordinatorRepo;
  }
  getAgentActivityRepo(): AgentActivityRepository {
    if (!this.agentActivityRepo) throw new Error('Database not initialized');
    return this.agentActivityRepo;
  }
}

export { DatabaseManager };
