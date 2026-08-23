import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../database/migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../database/migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../database/migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../database/migrations/018-authoring-amendments.js';
import { AuthoringAmendmentRepository } from '../../database/repositories/authoring-amendment-repository.js';
import { BusinessVersionRepository } from '../../database/repositories/business-version-repository.js';
import { SemanticAssetRepository } from '../../database/repositories/semantic-asset-repository.js';
import { SemanticCoordinatorRepository } from '../../database/repositories/semantic-coordinator-repository.js';
import { SemanticEvidenceRepository } from '../../database/repositories/semantic-evidence-repository.js';
import { hashValue } from '../../database/repositories/semantic-repository-utils.js';
import { SemanticRunControlRepository } from '../../database/repositories/semantic-run-control-repository.js';
import { SemanticQueryRepository } from '../../database/repositories/semantic-query-repository.js';
import { SemanticWorkflowRepository } from '../../database/repositories/semantic-workflow-repository.js';
import type {
  AgentTaskClientPort,
  AgentTaskView,
  CreateAgentTaskInput,
} from '../../infrastructure/agent-task-client.js';
import { MemoryCoordinatorSecretStore } from '../../infrastructure/coordinator-secret-store.js';
import type {
  BrowserLeaseView,
  BrowserSessionView,
  SemanticBrowserClientPort,
} from '../../infrastructure/semantic-browser-client.js';
import { SemanticCoordinatorService } from '../semantic-coordinator-service.js';
import { SemanticAuthoringCandidateService } from '../semantic-authoring-candidate-service.js';
import { SemanticAuthoringService } from '../semantic-authoring-service.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const SESSION_ID = '10000000-0000-4000-8000-000000000001';
const TAB_ID = '10000000-0000-4000-8000-000000000002';
const LEASE_ID = '10000000-0000-4000-8000-000000000003';

describe('SemanticCoordinatorService', () => {
  let db: DatabaseSync;
  let assets: SemanticAssetRepository;
  let workflows: SemanticWorkflowRepository;
  let evidence: SemanticEvidenceRepository;
  let runs: SemanticRunControlRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'Project')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    up018(db);
    assets = new SemanticAssetRepository(db);
    workflows = new SemanticWorkflowRepository(db);
    evidence = new SemanticEvidenceRepository(db);
    runs = new SemanticRunControlRepository(db, workflows, evidence);
  });

  afterEach(() => db.close());

  it('通过 FIFO、租约、Agent task、证据和显式关闭收敛正式运行', async () => {
    const fixture = createFixture(db, assets);
    const created = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'coordinator-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    runs.command({
      commandId: 'start-coordinator-run',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });

    const agent = new FakeAgentTaskClient();
    const browser = new FakeBrowserClient();
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: agent,
      browser,
      secretStore: new MemoryCoordinatorSecretStore(),
      artifactStore: { persist: async () => ({ storageKey: 'unused', sizeBytes: 0 }) } as never,
    });

    for (let index = 0; index < 16; index += 1) await coordinator.tick();

    expect(
      db.prepare('SELECT lifecycle, outcome FROM test_runs WHERE id = ?').get(created.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'passed',
    });
    expect(
      db.prepare('SELECT state FROM browser_jobs WHERE id = ?').get(created.browserJobId)
    ).toEqual({
      state: 'completed',
    });
    expect(db.prepare('SELECT state FROM run_todos WHERE run_id = ?').get(created.id)).toEqual({
      state: 'passed',
    });
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM external_task_links WHERE run_id = ?')
        .get(created.id)
    ).toEqual({ count: 3 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM evidence_manifests WHERE run_id = ? AND status = 'sealed'"
        )
        .get(created.id)
    ).toEqual({ count: 1 });
    expect(browser.closed).toBe(true);
    expect(browser.revoked).toBe(true);
    expect(agent.createdRequest?.browserBinding.browserLeaseToken).toBe('opaque-lease-token');
    const persistedAgentPayload = db
      .prepare(
        "SELECT payload_json_redacted FROM integration_outbox WHERE command_type = 'agent_task.create'"
      )
      .get() as { payload_json_redacted: string };
    expect(persistedAgentPayload.payload_json_redacted).not.toContain('opaque-lease-token');
  });

  it('把重启遗留的 dispatching outbox 恢复为可幂等重放', () => {
    const fixture = createFixture(db, assets);
    const created = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'recover-outbox-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    evidence.enqueueOutbox({
      id: 'recover-me',
      context: { type: 'run', id: created.id },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.close',
      endpointOrTool: '/sessions/:id',
      payloadRedacted: { runId: created.id },
    });
    expect(evidence.claimNextOutbox()).toMatchObject({ id: 'recover-me', status: 'dispatching' });
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: new FakeBrowserClient(),
      secretStore: new MemoryCoordinatorSecretStore(),
    });

    expect(coordinator.initialize()).toEqual({ recoveredOutbox: 1 });
    expect(
      db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get('recover-me')
    ).toEqual({
      status: 'retryable_failed',
    });
  });

  it('将模块修复输出固化为结构化候选且不直接覆盖当前 revision', async () => {
    const fixture = createFixture(db, assets);
    const versions = new BusinessVersionRepository(db);
    const amendments = new AuthoringAmendmentRepository(db, assets);
    const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
    const job = authoring.createJob({
      businessVersionId: fixture.versionId,
      mode: 'repair',
      idempotencyKey: 'repair-account-module',
      targetType: 'functional_module',
      targetId: fixture.moduleId,
      currentUrl: 'https://test.example/account',
      reason: '补充账号模块目标',
      createdBy: 'operator',
    });
    const candidatePayload = {
      ...fixture.modulePayload,
      goal: '清晰展示当前账号信息并提供可验证的刷新反馈',
    };
    const agent = new FakeAgentTaskClient({
      status: 'candidate_ready',
      summary: '已生成账号模块修复候选',
      category: 'repair',
      proposalsJson: JSON.stringify([
        {
          assetType: 'functional_module',
          assetId: fixture.moduleId,
          baseRevisionId: fixture.moduleRevisionId,
          candidatePayload,
          category: 'repair',
          reason: '补充可验证模块目标',
          targetUrl: 'https://test.example/account',
          targetPageDefinitionId: fixture.pageId,
          targetFunctionalModuleId: fixture.moduleId,
        },
      ]),
      validationPlanJson: JSON.stringify({ strategy: 'static_then_browser_verification' }),
      potentialSideEffectsJson: '{}',
    });
    const browser = new FakeBrowserClient();
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: agent,
      browser,
      secretStore: new MemoryCoordinatorSecretStore(),
      authoringCandidates: new SemanticAuthoringCandidateService(
        new SemanticQueryRepository(db, versions),
        assets,
        amendments
      ),
    });

    for (let index = 0; index < 16; index += 1) await coordinator.tick();

    expect(db.prepare('SELECT lifecycle FROM authoring_jobs WHERE id = ?').get(job.id)).toEqual({
      lifecycle: 'paused',
    });
    expect(db.prepare('SELECT state FROM authoring_tasks WHERE id = ?').get(job.taskId)).toEqual({
      state: 'succeeded',
    });
    const amendment = amendments.listAmendments(job.id)[0];
    expect(amendment).toMatchObject({ state: 'candidate_ready', category: 'repair' });
    const candidateRevisionId = String(amendment?.changes[0]?.candidateRevisionId);
    expect(candidateRevisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(
      db
        .prepare(
          "SELECT id FROM semantic_functional_module_revisions WHERE functional_module_id = ? AND lifecycle = 'current'"
        )
        .get(fixture.moduleId)
    ).toEqual({ id: fixture.moduleRevisionId });
    const candidateRevision = db
      .prepare(
        'SELECT payload_json, lifecycle FROM semantic_functional_module_revisions WHERE id = ?'
      )
      .get(candidateRevisionId) as { payload_json: string; lifecycle: string };
    expect(candidateRevision.lifecycle).toBe('draft');
    expect(JSON.parse(candidateRevision.payload_json)).toEqual(candidatePayload);
    expect(agent.createdRequest?.browserBinding.access).toBe('observe');
    expect(browser.revoked).toBe(true);
    expect(browser.closed).toBe(true);

    expect(authoring.command(amendment!.id, { action: 'queue_at_safe_boundary' })).toMatchObject({
      state: 'verifying',
    });
    const verificationActions: string[] = [];
    for (let index = 0; index < 18; index += 1) {
      verificationActions.push((await coordinator.tick()).action);
    }

    expect(verificationActions).toContain('authoring_verification.activated');
    expect(amendments.getAmendment(amendment!.id)).toMatchObject({ state: 'activated' });
    expect(
      db.prepare('SELECT lifecycle, outcome FROM authoring_jobs WHERE id = ?').get(job.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'succeeded',
    });
    expect(
      db
        .prepare(
          "SELECT id FROM semantic_functional_module_revisions WHERE functional_module_id = ? AND lifecycle = 'current'"
        )
        .get(fixture.moduleId)
    ).toEqual({ id: candidateRevisionId });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM evidence_manifests WHERE authoring_job_id = ? AND status = 'sealed'"
        )
        .get(job.id)
    ).toEqual({ count: 2 });
  });

  it('将显式浏览器定位限制为 navigation-only 控制任务且不生成候选', async () => {
    const fixture = createFixture(db, assets);
    const versions = new BusinessVersionRepository(db);
    const amendments = new AuthoringAmendmentRepository(db, assets);
    const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
    const job = authoring.createJob({
      businessVersionId: fixture.versionId,
      mode: 'recheck',
      intent: 'locate_in_browser',
      idempotencyKey: 'locate-account-page',
      targetType: 'functional_module',
      targetId: fixture.moduleId,
      currentUrl: 'https://test.example/account',
      reason: '在浏览器中定位账号页',
      createdBy: 'operator',
    });
    const agent = new FakeAgentTaskClient();
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: agent,
      browser: new FakeBrowserClient(),
      secretStore: new MemoryCoordinatorSecretStore(),
      authoringCandidates: new SemanticAuthoringCandidateService(
        new SemanticQueryRepository(db, versions),
        assets,
        amendments
      ),
    });

    for (let index = 0; index < 16; index += 1) await coordinator.tick();

    expect(agent.createdRequest?.clientTaskId).toBe(`authoring-locate:${job.taskId}`);
    expect(agent.createdRequest?.browserBinding.access).toBe('control');
    expect(agent.createdRequest?.toolPolicy).toMatchObject({
      allow: ['browser-control.operation_execute'],
      constraints: {
        'browser-control.operation_execute': {
          steps: [
            { stepId: 'locate-target-url', kind: 'act', operation: 'navigate' },
            { stepId: 'observe-located-page', kind: 'observe', operation: 'page_state' },
          ],
        },
      },
    });
    expect(amendments.listAmendments(job.id)).toEqual([]);
    expect(
      db.prepare('SELECT lifecycle, outcome FROM authoring_jobs WHERE id = ?').get(job.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'succeeded',
    });
  });
});

class FakeAgentTaskClient implements AgentTaskClientPort {
  createdRequest?: CreateAgentTaskInput;
  private readonly tasks = new Map<string, AgentTaskView>();

  constructor(private readonly authoringOutput?: Record<string, unknown>) {}

  async getCapabilities(): Promise<Record<string, unknown>> {
    return {
      schema: 'nebula.service-capabilities/1.0',
      service: 'ai-chat-service',
      protocols: { 'nebula.ai.agent-task': { major: 1, minor: 0 } },
      features: { localControlPlane: true },
      limits: {},
    };
  }

  async createTask(input: CreateAgentTaskInput): Promise<AgentTaskView> {
    this.createdRequest = input;
    const taskId = `agent-task-${this.tasks.size + 1}`;
    const verifying = input.clientTaskId.startsWith('authoring-verification:');
    const task: AgentTaskView = {
      schema: 'nebula.ai.agent-task/1.0',
      taskId,
      clientTaskId: input.clientTaskId,
      status: 'completed',
      stateVersion: 2,
      eventSeq: 3,
      output: verifying
        ? {
            result: 'succeeded',
            reasonClass: 'acceptance_passed',
            summary: '候选已通过真实浏览器验证',
          }
        : input.clientTaskId.startsWith('authoring-locate:')
          ? {
              status: 'no_change',
              summary: '已定位目标页面，未修改任何资产',
            }
          : input.clientTaskId.startsWith('authoring:')
            ? this.authoringOutput
            : {
                result: 'succeeded',
                reasonClass: 'acceptance_passed',
                summary: '所有硬断言通过',
                confirmedOutputsJson: '{}',
              },
      toolCalls: verifying
        ? [
            {
              toolCallId: 'verification-call-1',
              toolName: 'browser-control.operation_execute',
              status: 'succeeded',
              stepId: 'verify-current-page',
              operationId: 'verification-operation-1',
              operation: 'page_state',
            },
          ]
        : [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    return task;
  }

  async getTask(taskId: string): Promise<AgentTaskView> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('task not created');
    return task;
  }

  async commandTask(taskId: string): Promise<{ task: AgentTaskView }> {
    return { task: await this.getTask(taskId) };
  }
}

class FakeBrowserClient implements SemanticBrowserClientPort {
  closed = false;
  revoked = false;
  private activeLease?: BrowserLeaseView;
  private leaseCounter = 0;

  async getCapabilities(): Promise<Record<string, unknown>> {
    return {
      schema: 'nebula.service-capabilities/1.0',
      service: 'proxy-adapter',
      protocols: { browserExecution: { major: 1, minor: 0 } },
      features: { localControlPlane: true },
      limits: { maxActiveBrowserSessions: 1, maxBrowserContextsPerSession: 1 },
    };
  }

  async createSession(): Promise<BrowserSessionView> {
    this.closed = false;
    return this.session();
  }

  async getSession(): Promise<BrowserSessionView> {
    return this.session();
  }

  async createLease(
    _sessionId: string,
    _idempotencyKey: string,
    input: {
      mode: 'observe' | 'control';
      ttlSeconds?: number;
      tabIds?: string[];
      operations?: string[];
    }
  ): Promise<{ lease: BrowserLeaseView; token: string; tokenIssued: true }> {
    this.leaseCounter += 1;
    const leaseId = `10000000-0000-4000-8000-${String(this.leaseCounter).padStart(12, '0')}`;
    this.activeLease = {
      id: leaseId,
      sessionId: SESSION_ID,
      mode: input.mode,
      sequence: 1,
      status: 'active',
      policy: { tabIds: input.tabIds ?? [TAB_ID], operations: input.operations ?? ['page_state'] },
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    return { lease: this.activeLease, token: 'opaque-lease-token', tokenIssued: true };
  }

  async revokeLease(): Promise<BrowserLeaseView> {
    this.revoked = true;
    const lease = { ...this.activeLease!, status: 'revoked' as const };
    this.activeLease = undefined;
    return lease;
  }

  async closeSession(): Promise<BrowserSessionView> {
    this.closed = true;
    return this.session('closed');
  }

  async getOperation(operationId: string) {
    return {
      operationId,
      sessionId: SESSION_ID,
      leaseId: this.activeLease?.id ?? LEASE_ID,
      leaseSequence: 1,
      tabId: TAB_ID,
      kind: 'observe' as const,
      operation: 'page_state',
      status: 'succeeded' as const,
      actual: { url: 'https://test.example/account' },
      artifacts: [],
    };
  }

  async downloadArtifact(): Promise<Buffer> {
    throw new Error('not used');
  }

  private session(
    status: BrowserSessionView['status'] = this.closed ? 'closed' : 'active'
  ): BrowserSessionView {
    return {
      id: SESSION_ID,
      status,
      tabs: [{ id: TAB_ID, url: 'https://test.example/account', title: 'Account', isActive: true }],
      activeLeases: this.activeLease ? [this.activeLease] : [],
      liveView: { available: true, controlAllowed: false },
      viewport: { width: 1920, height: 1080 },
      createdAt: new Date().toISOString(),
    };
  }
}

function createFixture(db: DatabaseSync, assets: SemanticAssetRepository) {
  const versions = new BusinessVersionRepository(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO deployment_profiles (id, project_id, profile_key, name, created_at)
     VALUES ('deployment-test', 'project-1', 'test', 'Test', ?)`
  ).run(now);
  db.prepare(
    `INSERT INTO deployment_profile_revisions
      (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
       content_sha256, validation_status, change_reason, created_by_type, created_at)
     VALUES ('deployment-revision-test', 'deployment-test', 1, 'current',
       'nebula.ai-e2e.deployment-profile/1.0', ?, ?, 'valid', 'fixture', 'system', ?)`
  ).run(
    JSON.stringify({
      schema: 'nebula.ai-e2e.deployment-profile/1.0',
      environment: 'test',
      origin: 'https://test.example',
      allowedOrigins: ['https://test.example'],
    }),
    HASH_A,
    now
  );
  const version = versions.create({
    projectId: 'project-1',
    versionKey: 'release-test',
    name: 'Release Test',
    createdBy: 'system',
    requestId: 'create-release-test',
    deploymentRevisionId: 'deployment-revision-test',
  }).version;
  const page = versions.createPage({
    businessVersionId: version.id,
    pageKey: 'account',
    payload: {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: '账号页',
      routeMode: 'path',
      routeTemplate: '/account',
      identityQuery: {},
      runtimeParams: {},
      ignoredQueryKeys: [],
      authRequirement: { kind: 'anonymous' },
      recognition: [],
      allowedTransitionPageIds: [],
    },
    createdBy: 'system',
  });
  const businessModule = versions.createBusinessModule({
    businessVersionId: version.id,
    moduleKey: 'account',
    payload: {
      schema: 'nebula.ai-e2e.business-module/1.0',
      name: '账号',
      sortOrder: 0,
      prdSourceRefs: [],
    },
    createdBy: 'system',
  });
  const module = versions.createFunctionalModule({
    businessVersionId: version.id,
    businessModuleId: businessModule.id,
    moduleKey: 'account.view',
    primaryPageDefinitionId: page.id,
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: '账号查看',
      sortOrder: 0,
      primaryPageDefinitionId: page.id,
    },
    createdBy: 'system',
  });
  const script = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: module.id,
    scriptKey: 'account.view',
    name: '查看账号',
    payload: {
      schema: 'nebula.ai-e2e.functional-script/1.0',
      scriptKey: 'account.view',
      functionalModuleId: module.id,
      entryPageDefinitionId: page.id,
      steps: [{ id: 'step_observe', action: 'observe', postconditions: [] }],
      sideEffects: [],
      finalAssertions: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const scenario = versions.createScenario({
    businessVersionId: version.id,
    scenarioKey: 'account-flow',
    name: '账号流程',
    payload: {
      schema: 'nebula.ai-e2e.scenario/1.0',
      scenarioKey: 'account-flow',
      name: '账号流程',
      purpose: '验证协调执行',
      prdSourceRefs: [],
      actors: [],
      initialAuth: { kind: 'anonymous' },
      inputs: [],
      finalAcceptance: [],
      calls: [{ callKey: 'view', functionalScriptId: script.id }],
      edges: [],
      exports: [],
    },
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const verificationScope = { locale: 'zh-CN', viewport: 'desktop' };
  assets.recordBusinessVersionValidation({
    businessVersionId: version.id,
    deploymentRevisionId: 'deployment-revision-test',
    assetGraphSha256: HASH_A,
    verificationScope,
    status: 'valid',
  });
  for (const executable of [
    {
      assetType: 'functional_script' as const,
      assetId: script.id,
      revisionId: script.currentRevision.id,
    },
    {
      assetType: 'test_scenario' as const,
      assetId: scenario.id,
      revisionId: scenario.currentRevision.id,
    },
  ]) {
    assets.recordVerification({
      businessVersionId: version.id,
      assetType: executable.assetType,
      assetId: executable.assetId,
      assetRevisionId: executable.revisionId,
      deploymentRevisionId: 'deployment-revision-test',
      verificationScope,
      dependencyClosureSha256: HASH_B,
      status: 'verified',
    });
  }
  expect(hashValue(verificationScope)).toMatch(/^[a-f0-9]{64}$/);
  return {
    versionId: version.id,
    deploymentRevisionId: 'deployment-revision-test',
    scenarioRevisionId: scenario.currentRevision.id,
    pageId: page.id,
    moduleId: module.id,
    moduleRevisionId: module.currentRevision.id,
    modulePayload: module.currentRevision.payload,
  };
}
