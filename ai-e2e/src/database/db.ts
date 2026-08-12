import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { up as migrate001 } from './migrations/001-projects.js';
import { up as migrate002 } from './migrations/002-prd-documents.js';
import { up as migrate003 } from './migrations/003-business-modules.js';
import { up as migrate004 } from './migrations/004-functional-modules.js';
import { up as migrate005 } from './migrations/005-urls.js';
import { up as migrate006 } from './migrations/006-url-module-bindings.js';
import { up as migrate007 } from './migrations/007-test-scenarios.js';
import { up as migrate008 } from './migrations/008-scripts.js';
import { up as migrate009 } from './migrations/009-execution-runs.js';
import { up as migrate010 } from './migrations/010-ai-intervention-logs.js';
import { up as migrate011 } from './migrations/011-exploration-sessions.js';
import { up as migrate012 } from './migrations/012-login-scripts.js';
import { up as migrate013 } from './migrations/013-add-failure-type-to-intervention-logs.js';
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
import { runTrackedMigration } from './migration-runner.js';
import { ProjectRepository } from './repositories/project-repository.js';
import { PRDDocumentRepository } from './repositories/prd-document-repository.js';
import { BusinessModuleRepository } from './repositories/business-module-repository.js';
import { FunctionalModuleRepository } from './repositories/functional-module-repository.js';
import { URLRepository } from './repositories/url-repository.js';
import { URLModuleBindingRepository } from './repositories/url-module-binding-repository.js';
import { TestScenarioRepository } from './repositories/test-scenario-repository.js';
import { ScriptRepository } from './repositories/script-repository.js';
import { ExecutionRunRepository } from './repositories/execution-run-repository.js';
import { AIInterventionLogRepository } from './repositories/ai-intervention-log-repository.js';
import { ExplorationSessionRepository } from './repositories/exploration-session-repository.js';
import { LoginScriptRepository } from './repositories/login-script-repository.js';
import { BusinessVersionRepository } from './repositories/business-version-repository.js';
import { SemanticAssetRepository } from './repositories/semantic-asset-repository.js';
import { SemanticEvidenceRepository } from './repositories/semantic-evidence-repository.js';
import { SemanticWorkflowRepository } from './repositories/semantic-workflow-repository.js';

export function generateId(): string {
  return randomBytes(8).toString('hex');
}

class DatabaseManager {
  private static instance: DatabaseManager | null = null;
  private db: Database.Database | null = null;
  private isInitialized = false;

  private projectRepo: ProjectRepository | null = null;
  private prdDocumentRepo: PRDDocumentRepository | null = null;
  private businessModuleRepo: BusinessModuleRepository | null = null;
  private functionalModuleRepo: FunctionalModuleRepository | null = null;
  private urlRepo: URLRepository | null = null;
  private urlModuleBindingRepo: URLModuleBindingRepository | null = null;
  private testScenarioRepo: TestScenarioRepository | null = null;
  private scriptRepo: ScriptRepository | null = null;
  private executionRunRepo: ExecutionRunRepository | null = null;
  private aiInterventionLogRepo: AIInterventionLogRepository | null = null;
  private explorationSessionRepo: ExplorationSessionRepository | null = null;
  private loginScriptRepo: LoginScriptRepository | null = null;
  private businessVersionRepo: BusinessVersionRepository | null = null;
  private semanticAssetRepo: SemanticAssetRepository | null = null;
  private semanticWorkflowRepo: SemanticWorkflowRepository | null = null;
  private semanticEvidenceRepo: SemanticEvidenceRepository | null = null;

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
    migrate002(this.db);
    migrate003(this.db);
    migrate004(this.db);
    migrate005(this.db);
    migrate006(this.db);
    migrate007(this.db);
    migrate008(this.db);
    migrate009(this.db);
    migrate010(this.db);
    migrate011(this.db);
    migrate012(this.db);
    migrate013(this.db);
    migrate014(this.db);
    for (const migration of [
      { id: migration015Id, name: migration015Name, sql: migration015Sql },
      { id: migration016Id, name: migration016Name, sql: migration016Sql },
      { id: migration017Id, name: migration017Name, sql: migration017Sql },
    ]) {
      runTrackedMigration(this.db, migration, '1.0.0');
    }
  }

  private initRepositories(): void {
    if (!this.db) throw new Error('Database not initialized');
    this.projectRepo = new ProjectRepository(this.db);
    this.prdDocumentRepo = new PRDDocumentRepository(this.db);
    this.businessModuleRepo = new BusinessModuleRepository(this.db);
    this.functionalModuleRepo = new FunctionalModuleRepository(this.db);
    this.urlRepo = new URLRepository(this.db);
    this.urlModuleBindingRepo = new URLModuleBindingRepository(this.db);
    this.testScenarioRepo = new TestScenarioRepository(this.db);
    this.scriptRepo = new ScriptRepository(this.db);
    this.executionRunRepo = new ExecutionRunRepository(this.db);
    this.aiInterventionLogRepo = new AIInterventionLogRepository(this.db);
    this.explorationSessionRepo = new ExplorationSessionRepository(this.db);
    this.loginScriptRepo = new LoginScriptRepository(this.db);
    this.businessVersionRepo = new BusinessVersionRepository(this.db);
    this.semanticAssetRepo = new SemanticAssetRepository(this.db);
    this.semanticWorkflowRepo = new SemanticWorkflowRepository(this.db);
    this.semanticEvidenceRepo = new SemanticEvidenceRepository(this.db);
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
      this.projectRepo = null;
      this.prdDocumentRepo = null;
      this.businessModuleRepo = null;
      this.functionalModuleRepo = null;
      this.urlRepo = null;
      this.urlModuleBindingRepo = null;
      this.testScenarioRepo = null;
      this.scriptRepo = null;
      this.executionRunRepo = null;
      this.aiInterventionLogRepo = null;
      this.explorationSessionRepo = null;
      this.loginScriptRepo = null;
      this.businessVersionRepo = null;
      this.semanticAssetRepo = null;
      this.semanticWorkflowRepo = null;
      this.semanticEvidenceRepo = null;
    }
  }

  getProjectRepo(): ProjectRepository { if (!this.projectRepo) throw new Error('Database not initialized'); return this.projectRepo; }
  getPRDDocumentRepo(): PRDDocumentRepository { if (!this.prdDocumentRepo) throw new Error('Database not initialized'); return this.prdDocumentRepo; }
  getBusinessModuleRepo(): BusinessModuleRepository { if (!this.businessModuleRepo) throw new Error('Database not initialized'); return this.businessModuleRepo; }
  getFunctionalModuleRepo(): FunctionalModuleRepository { if (!this.functionalModuleRepo) throw new Error('Database not initialized'); return this.functionalModuleRepo; }
  getURLRepo(): URLRepository { if (!this.urlRepo) throw new Error('Database not initialized'); return this.urlRepo; }
  getURLModuleBindingRepo(): URLModuleBindingRepository { if (!this.urlModuleBindingRepo) throw new Error('Database not initialized'); return this.urlModuleBindingRepo; }
  getTestScenarioRepo(): TestScenarioRepository { if (!this.testScenarioRepo) throw new Error('Database not initialized'); return this.testScenarioRepo; }
  getScriptRepo(): ScriptRepository { if (!this.scriptRepo) throw new Error('Database not initialized'); return this.scriptRepo; }
  getExecutionRunRepo(): ExecutionRunRepository { if (!this.executionRunRepo) throw new Error('Database not initialized'); return this.executionRunRepo; }
  getAIInterventionLogRepo(): AIInterventionLogRepository { if (!this.aiInterventionLogRepo) throw new Error('Database not initialized'); return this.aiInterventionLogRepo; }
  getExplorationSessionRepo(): ExplorationSessionRepository { if (!this.explorationSessionRepo) throw new Error('Database not initialized'); return this.explorationSessionRepo; }
  getLoginScriptRepo(): LoginScriptRepository { if (!this.loginScriptRepo) throw new Error('Database not initialized'); return this.loginScriptRepo; }
  getBusinessVersionRepo(): BusinessVersionRepository { if (!this.businessVersionRepo) throw new Error('Database not initialized'); return this.businessVersionRepo; }
  getSemanticAssetRepo(): SemanticAssetRepository { if (!this.semanticAssetRepo) throw new Error('Database not initialized'); return this.semanticAssetRepo; }
  getSemanticWorkflowRepo(): SemanticWorkflowRepository { if (!this.semanticWorkflowRepo) throw new Error('Database not initialized'); return this.semanticWorkflowRepo; }
  getSemanticEvidenceRepo(): SemanticEvidenceRepository { if (!this.semanticEvidenceRepo) throw new Error('Database not initialized'); return this.semanticEvidenceRepo; }
}

export { DatabaseManager };
