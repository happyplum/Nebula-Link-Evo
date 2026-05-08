import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../database/index.js';
import { generateId } from '../../database/db.js';
import { up as migrate001 } from '../../database/migrations/001-projects.js';
import { up as migrate002 } from '../../database/migrations/002-prd-documents.js';
import { up as migrate003 } from '../../database/migrations/003-business-modules.js';
import { up as migrate005 } from '../../database/migrations/005-urls.js';
import { up as migrate004 } from '../../database/migrations/004-functional-modules.js';
import { up as migrate006 } from '../../database/migrations/006-url-module-bindings.js';
import { up as migrate007 } from '../../database/migrations/007-test-scenarios.js';
import { up as migrate008 } from '../../database/migrations/008-scripts.js';
import { up as migrate009 } from '../../database/migrations/009-execution-runs.js';
import { up as migrate010 } from '../../database/migrations/010-ai-intervention-logs.js';
import { up as migrate011 } from '../../database/migrations/011-exploration-sessions.js';
import { up as migrate012 } from '../../database/migrations/012-login-scripts.js';
import { ProjectRepository } from '../../database/repositories/project-repository.js';
import { PRDDocumentRepository } from '../../database/repositories/prd-document-repository.js';
import { BusinessModuleRepository } from '../../database/repositories/business-module-repository.js';
import { FunctionalModuleRepository } from '../../database/repositories/functional-module-repository.js';
import { URLRepository } from '../../database/repositories/url-repository.js';
import { URLModuleBindingRepository } from '../../database/repositories/url-module-binding-repository.js';
import { TestScenarioRepository } from '../../database/repositories/test-scenario-repository.js';
import { ScriptRepository } from '../../database/repositories/script-repository.js';
import { ExecutionRunRepository } from '../../database/repositories/execution-run-repository.js';
import { AIInterventionLogRepository } from '../../database/repositories/ai-intervention-log-repository.js';
import { ExplorationSessionRepository } from '../../database/repositories/exploration-session-repository.js';
import { LoginScriptRepository } from '../../database/repositories/login-script-repository.js';

function runAllMigrations(db: Database.Database): void {
  migrate001(db);
  migrate002(db);
  migrate003(db);
  migrate005(db);
  migrate004(db);
  migrate006(db);
  migrate007(db);
  migrate008(db);
  migrate009(db);
  migrate010(db);
  migrate011(db);
  migrate012(db);
}

function createFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runAllMigrations(db);
  return db;
}

function createTestChain(db: Database.Database, includeTestScenario = false) {
  const projectId = generateId();
  db.prepare("INSERT INTO projects (id, name) VALUES (?, 'test-project')").run(projectId);
  const bmId = generateId();
  db.prepare("INSERT INTO business_modules (id, project_id, name) VALUES (?, ?, 'bm')").run(bmId, projectId);
  const fmId = generateId();
  db.prepare("INSERT INTO functional_modules (id, business_module_id, name) VALUES (?, ?, 'fm')").run(fmId, bmId);
  let tsId: string | undefined;
  if (includeTestScenario) {
    tsId = generateId();
    db.prepare("INSERT INTO test_scenarios (id, functional_module_id, name) VALUES (?, ?, 'scenario')").run(tsId, fmId);
  }
  return { projectId, bmId, fmId, tsId };
}

describe('DatabaseManager', () => {
  afterEach(() => {
    DatabaseManager.resetInstance();
  });

  it('should initialize with in-memory database', () => {
    const mgr = DatabaseManager.getInstance();
    mgr.init(':memory:');
    expect(mgr.getProjectRepo()).toBeDefined();
    expect(mgr.getDatabase()).toBeDefined();
  });

  it('should be a singleton', () => {
    const a = DatabaseManager.getInstance();
    const b = DatabaseManager.getInstance();
    expect(a).toBe(b);
  });

  it('resetInstance should allow re-initialization', () => {
    const a = DatabaseManager.getInstance();
    a.init(':memory:');
    DatabaseManager.resetInstance();
    const b = DatabaseManager.getInstance();
    b.init(':memory:');
    expect(b).not.toBe(a);
  });
});

describe('ProjectRepository', () => {
  let db: Database.Database;
  let repo: ProjectRepository;

  beforeEach(() => {
    db = createFreshDb();
    repo = new ProjectRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should create and find a project', () => {
    const project = repo.create({ name: 'My Project', target_base_url: 'https://example.com' });
    expect(project.id).toBeTruthy();
    expect(project.name).toBe('My Project');
    expect(project.status).toBe('draft');

    const found = repo.findById(project.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('My Project');
  });

  it('should update a project', () => {
    const project = repo.create({ name: 'Old Name' });
    const updated = repo.update(project.id, { name: 'New Name', status: 'analyzing' });
    expect(updated!.name).toBe('New Name');
    expect(updated!.status).toBe('analyzing');
  });

  it('should delete a project', () => {
    const project = repo.create({ name: 'To Delete' });
    expect(repo.delete(project.id)).toBe(true);
    expect(repo.findById(project.id)).toBeNull();
  });

  it('should find projects by status', () => {
    repo.create({ name: 'A', status: 'draft' });
    repo.create({ name: 'B', status: 'ready' });
    repo.create({ name: 'C', status: 'draft' });

    const drafts = repo.findByStatus('draft');
    expect(drafts).toHaveLength(2);
  });

  it('should update project status', () => {
    const project = repo.create({ name: 'P' });
    const updated = repo.updateStatus(project.id, 'ready');
    expect(updated!.status).toBe('ready');
  });

  it('should list all projects', () => {
    repo.create({ name: 'A' });
    repo.create({ name: 'B' });
    expect(repo.findAll()).toHaveLength(2);
  });
});

describe('PRDDocumentRepository', () => {
  let db: Database.Database;
  let repo: PRDDocumentRepository;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new PRDDocumentRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find a PRD document', () => {
    const doc = repo.create({ project_id: String(projectId), raw_content: '# PRD\nSome content' });
    expect(doc.id).toBeTruthy();
    expect(doc.raw_content).toBe('# PRD\nSome content');
    expect(doc.format).toBe('markdown');
  });

  it('should find documents by project', () => {
    repo.create({ project_id: String(projectId), raw_content: 'A' });
    repo.create({ project_id: String(projectId), raw_content: 'B' });
    expect(repo.findByProjectId(String(projectId))).toHaveLength(2);
  });

  it('should update a document', () => {
    const doc = repo.create({ project_id: String(projectId), raw_content: 'old' });
    const updated = repo.update(doc.id, { raw_content: 'new', token_count: 42 });
    expect(updated!.raw_content).toBe('new');
    expect(updated!.token_count).toBe(42);
  });
});

describe('BusinessModuleRepository', () => {
  let db: Database.Database;
  let repo: BusinessModuleRepository;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new BusinessModuleRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by project', () => {
    repo.create({ project_id: String(projectId), name: 'Auth' });
    repo.create({ project_id: String(projectId), name: 'Billing' });
    const modules = repo.findByProjectId(String(projectId));
    expect(modules).toHaveLength(2);
  });

  it('should reorder modules', () => {
    const m1 = repo.create({ project_id: String(projectId), name: 'A', sort_order: 0 });
    const m2 = repo.create({ project_id: String(projectId), name: 'B', sort_order: 1 });

    repo.reorder([m2.id, m1.id]);

    const found1 = repo.findById(m1.id);
    const found2 = repo.findById(m2.id);
    expect(found1!.sort_order).toBe(1);
    expect(found2!.sort_order).toBe(0);
  });
});

describe('FunctionalModuleRepository', () => {
  let db: Database.Database;
  let repo: FunctionalModuleRepository;
  let bmId: string | number;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new FunctionalModuleRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
    bmId = generateId();
    db.prepare("INSERT INTO business_modules (id, project_id, name) VALUES (?, ?, 'bm')").run(bmId, projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by business module', () => {
    repo.create({ business_module_id: String(bmId), name: 'Login' });
    repo.create({ business_module_id: String(bmId), name: 'Register' });
    expect(repo.findByBusinessModuleId(String(bmId))).toHaveLength(2);
  });

  it('should update bound URL', () => {
    const fm = repo.create({ business_module_id: String(bmId), name: 'FM' });
    const urlId = generateId();
    db.prepare("INSERT INTO urls (id, project_id, url) VALUES (?, ?, '/page')").run(urlId, projectId);
    const updated = repo.updateBoundUrl(fm.id, String(urlId));
    expect(updated!.bound_url_id).toBe(String(urlId));
  });
});

describe('URLRepository', () => {
  let db: Database.Database;
  let repo: URLRepository;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new URLRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by project', () => {
    repo.create({ project_id: String(projectId), url: '/login' });
    repo.create({ project_id: String(projectId), url: '/dashboard' });
    expect(repo.findByProjectId(String(projectId))).toHaveLength(2);
  });

  it('should find unbound URLs', () => {
    const urlId = repo.create({ project_id: String(projectId), url: '/unbound' }).id;
    const unbound = repo.findUnbound(String(projectId));
    expect(unbound).toHaveLength(1);
    expect(unbound[0].id).toBe(urlId);
  });

  it('should mark auth_required', () => {
    const url = repo.create({ project_id: String(projectId), url: '/admin', auth_required: true });
    expect(url.auth_required).toBe(1);
  });
});

describe('URLModuleBindingRepository', () => {
  let db: Database.Database;
  let repo: URLModuleBindingRepository;
  let urlId: string | number;
  let fmId: string | number;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new URLModuleBindingRepository(db);
    const chain = createTestChain(db);
    urlId = generateId();
    db.prepare("INSERT INTO urls (id, project_id, url) VALUES (?, ?, '/page')").run(urlId, chain.projectId);
    fmId = chain.fmId;
    projectId = chain.projectId;
  });

  afterEach(() => { db.close(); });

  it('should create and find by module', () => {
    repo.create({ url_id: String(urlId), functional_module_id: String(fmId) });
    const bindings = repo.findByModuleId(String(fmId));
    expect(bindings).toHaveLength(1);
    expect(bindings[0].status).toBe('ai_proposed');
  });

  it('should find by project', () => {
    repo.create({ url_id: String(urlId), functional_module_id: String(fmId) });
    const bindings = repo.findByProjectId(String(projectId));
    expect(bindings).toHaveLength(1);
  });
});

describe('TestScenarioRepository', () => {
  let db: Database.Database;
  let repo: TestScenarioRepository;
  let fmId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new TestScenarioRepository(db);
    const chain = createTestChain(db);
    fmId = chain.fmId;
  });

  afterEach(() => { db.close(); });

  it('should create and find by functional module', () => {
    repo.create({ functional_module_id: String(fmId), name: 'Test login' });
    repo.create({ functional_module_id: String(fmId), name: 'Test register' });
    expect(repo.findByFunctionalModuleId(String(fmId))).toHaveLength(2);
  });
});

describe('ScriptRepository', () => {
  let db: Database.Database;
  let repo: ScriptRepository;
  let tsId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new ScriptRepository(db);
    const chain = createTestChain(db, true);
    tsId = chain.tsId!;
  });

  afterEach(() => { db.close(); });

  it('should create and find latest by scenario', () => {
    repo.create({ test_scenario_id: String(tsId), content: 'v1', version: 1 });
    repo.create({ test_scenario_id: String(tsId), content: 'v2', version: 2 });
    const latest = repo.findLatestByScenarioId(String(tsId));
    expect(latest!.version).toBe(2);
    expect(latest!.content).toBe('v2');
  });

  it('should create version with auto-increment', () => {
    repo.create({ test_scenario_id: String(tsId), content: 'first' });
    const v2 = repo.createVersion(String(tsId), 'second', 'ai_generated');
    expect(v2.version).toBe(2);
    expect(v2.content).toBe('second');
  });

  it('should find scripts by status', () => {
    repo.create({ test_scenario_id: String(tsId), content: 'a', status: 'generated' });
    repo.create({ test_scenario_id: String(tsId), content: 'b', status: 'passed' });
    expect(repo.findByStatus('generated')).toHaveLength(1);
  });
});

describe('ExecutionRunRepository', () => {
  let db: Database.Database;
  let repo: ExecutionRunRepository;
  let scriptId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new ExecutionRunRepository(db);
    const chain = createTestChain(db, true);
    scriptId = generateId();
    db.prepare("INSERT INTO scripts (id, test_scenario_id, content) VALUES (?, ?, 'code')").run(scriptId, chain.tsId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by script', () => {
    repo.create({ script_id: String(scriptId), script_version: 1 });
    repo.create({ script_id: String(scriptId), script_version: 2 });
    const runs = repo.findByScriptId(String(scriptId));
    expect(runs).toHaveLength(2);
  });

  it('should find latest run for script', () => {
    repo.create({ script_id: String(scriptId), script_version: 1 });
    const latest = repo.findLatest(String(scriptId));
    expect(latest).not.toBeNull();
    expect(latest!.status).toBe('running');
  });

  it('should update run to completed', () => {
    const run = repo.create({ script_id: String(scriptId), script_version: 1 });
    const updated = repo.update(run.id, { status: 'pass', completed_at: new Date().toISOString() });
    expect(updated!.status).toBe('pass');
    expect(updated!.completed_at).not.toBeNull();
  });
});

describe('AIInterventionLogRepository', () => {
  let db: Database.Database;
  let repo: AIInterventionLogRepository;
  let runId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new AIInterventionLogRepository(db);
    const chain = createTestChain(db, true);
    const scriptId = generateId();
    db.prepare("INSERT INTO scripts (id, test_scenario_id, content) VALUES (?, ?, 'code')").run(scriptId, chain.tsId);
    runId = generateId();
    db.prepare("INSERT INTO execution_runs (id, script_id, script_version) VALUES (?, ?, 1)").run(runId, scriptId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by run', () => {
    repo.create({ execution_run_id: String(runId), diagnosis: 'timeout', action_taken: 'auto_fix_applied' });
    repo.create({ execution_run_id: String(runId), diagnosis: 'selector miss' });
    expect(repo.findByRunId(String(runId))).toHaveLength(2);
  });
});

describe('ExplorationSessionRepository', () => {
  let db: Database.Database;
  let repo: ExplorationSessionRepository;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new ExplorationSessionRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by project', () => {
    repo.create({ project_id: String(projectId), strategy_used: 'breadth-first' });
    repo.create({ project_id: String(projectId), strategy_used: 'depth-first' });
    expect(repo.findByProjectId(String(projectId))).toHaveLength(2);
  });

  it('should find latest session for project', () => {
    repo.create({ project_id: String(projectId), strategy_used: 'first' });
    const latest = repo.findLatest(String(projectId));
    expect(latest).not.toBeNull();
    expect(latest!.strategy_used).toBe('first');
  });
});

describe('LoginScriptRepository', () => {
  let db: Database.Database;
  let repo: LoginScriptRepository;
  let projectId: string | number;

  beforeEach(() => {
    db = createFreshDb();
    repo = new LoginScriptRepository(db);
    projectId = generateId();
    db.prepare("INSERT INTO projects (id, name) VALUES (?, 'p')").run(projectId);
  });

  afterEach(() => { db.close(); });

  it('should create and find by project', () => {
    repo.create({ project_id: String(projectId), name: 'Admin Login', steps_json: '[{"action":"click"}]' });
    const scripts = repo.findByProjectId(String(projectId));
    expect(scripts).toHaveLength(1);
    expect(scripts[0].name).toBe('Admin Login');
    expect(JSON.parse(scripts[0].steps_json)).toEqual([{ action: 'click' }]);
  });

  it('should update a login script', () => {
    const script = repo.create({ project_id: String(projectId), name: 'Old', steps_json: '[]' });
    const updated = repo.update(script.id, { name: 'Updated', steps_json: '[{"action":"type"}]' });
    expect(updated!.name).toBe('Updated');
  });
});
