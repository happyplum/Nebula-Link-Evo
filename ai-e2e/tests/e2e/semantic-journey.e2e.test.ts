import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp as buildProxyApp } from '../../../proxy-adapter/src/server.js';
import { AgentTaskRepository } from '../../../ai-chat-service/src/agent-tasks/repository.js';
import { AgentTaskService } from '../../../ai-chat-service/src/agent-tasks/service.js';
import type {
  AgentTaskExecutionContext,
  AgentTaskExecutionResult,
  AgentTaskExecutor,
  AgentTaskToolCallSummary,
} from '../../../ai-chat-service/src/agent-tasks/types.js';
import agentTaskRoutes from '../../../ai-chat-service/src/plugins/routes/api/agent-tasks.js';
import { DatabaseManager } from '../../src/database/db.js';
import { hashValue } from '../../src/database/repositories/semantic-repository-utils.js';
import { AgentTaskClient } from '../../src/infrastructure/agent-task-client.js';
import { SemanticBrowserClient } from '../../src/infrastructure/semantic-browser-client.js';
import { createServer } from '../../src/server/index.js';
import { BusinessVersionService } from '../../src/services/business-version-service.js';
import { SemanticAuthoringCandidateService } from '../../src/services/semantic-authoring-candidate-service.js';
import { SemanticAuthoringService } from '../../src/services/semantic-authoring-service.js';
import { SemanticCoordinatorService } from '../../src/services/semantic-coordinator-service.js';
import { SemanticProjectService } from '../../src/services/semantic-project-service.js';
import { SemanticQueryService } from '../../src/services/semantic-query-service.js';
import { SemanticRunService } from '../../src/services/semantic-run-service.js';

const HASH_B = 'b'.repeat(64);

describe('semantic product journey', () => {
  let root: string;
  let proxyApp: Awaited<ReturnType<typeof buildProxyApp>>;
  let proxyUrl: string;
  let aiChatApp: FastifyInstance;
  let aiChatUrl: string;
  let aiE2eApp: ReturnType<typeof createServer>;
  let aiE2eUrl: string;
  let agentTaskService: AgentTaskService;
  let coordinator: SemanticCoordinatorService;
  let executor: DeterministicBrowserExecutor;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'nebula-semantic-journey-'));
    proxyApp = await buildProxyApp({ dataDir: join(root, 'proxy'), skipBackups: true });
    proxyUrl = await proxyApp.listen({ host: '127.0.0.1', port: 0 });

    executor = new DeterministicBrowserExecutor(proxyUrl);
    agentTaskService = new AgentTaskService(
      new AgentTaskRepository(':memory:'),
      executor,
      quietLogger
    );
    aiChatApp = Fastify({ logger: false });
    await aiChatApp.register(agentTaskRoutes, {
      prefix: '/api/v1',
      service: agentTaskService,
      serviceVersion: 'e2e',
      localControlPlane: true,
    });
    aiChatUrl = await aiChatApp.listen({ host: '127.0.0.1', port: 0 });

    DatabaseManager.resetInstance();
    const database = DatabaseManager.getInstance();
    database.init(':memory:');
    const versions = database.getBusinessVersionRepo();
    const assets = database.getSemanticAssetRepo();
    const amendments = database.getAuthoringAmendmentRepo();
    const workflows = database.getSemanticWorkflowRepo();
    const runs = database.getSemanticRunControlRepo();
    const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
    const runService = new SemanticRunService(runs);
    coordinator = new SemanticCoordinatorService({
      repository: database.getSemanticCoordinatorRepo(),
      workflows,
      evidence: database.getSemanticEvidenceRepo(),
      runs,
      agentTasks: new AgentTaskClient({ baseUrl: aiChatUrl, timeoutMs: 30_000 }),
      browser: new SemanticBrowserClient({ baseUrl: proxyUrl, timeoutMs: 30_000 }),
      authoringCandidates: new SemanticAuthoringCandidateService(
        database.getSemanticQueryRepo(),
        assets,
        amendments
      ),
    });
    aiE2eApp = createServer({
      semanticProjectService: new SemanticProjectService(database.getSemanticProjectRepo()),
      businessVersionService: new BusinessVersionService(versions),
      semanticQueryService: new SemanticQueryService(database.getSemanticQueryRepo()),
      semanticAuthoringService: authoring,
      semanticRunService: runService,
    });
    aiE2eUrl = await aiE2eApp.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await Promise.all([aiE2eApp.close(), aiChatApp.close(), proxyApp.close()]);
    await agentTaskService.close();
    DatabaseManager.resetInstance();
    await rm(root, { recursive: true, force: true });
  });

  it('creates, repairs, verifies, activates and executes a formal run over the three services', async () => {
    const created = await request('POST', '/api/v1/projects', {
      headers: { 'idempotency-key': 'semantic-e2e-project' },
      body: {
        name: 'Semantic E2E',
        versionKey: 'v1',
        versionName: 'Version 1',
        targetOrigin: 'https://example.test',
        environment: 'test',
        prd: { format: 'markdown', content: '# Verify the semantic journey' },
        createdBy: 'e2e',
      },
    });
    expect(created.status).toBe(201);
    const workspace = created.data as {
      id: string;
      versionId: string;
      deploymentRevisionId: string;
    };
    const database = DatabaseManager.getInstance();
    const db = database.getDatabase();
    const module = db
      .prepare(
        `SELECT modules.id, revisions.id AS revision_id, revisions.payload_json
         FROM semantic_functional_modules AS modules
         JOIN semantic_functional_module_revisions AS revisions
           ON revisions.functional_module_id = modules.id AND revisions.lifecycle = 'current'
         WHERE modules.business_version_id = ?`
      )
      .get(workspace.versionId) as { id: string; revision_id: string; payload_json: string };
    const modulePayload = JSON.parse(module.payload_json) as { primaryPageDefinitionId: string };
    executor.authoringCandidate = {
      moduleId: module.id,
      baseRevisionId: module.revision_id,
      pageId: modulePayload.primaryPageDefinitionId,
      payload: { ...modulePayload, goal: 'Verified by the product E2E journey' },
    };

    const job = await request(
      'POST',
      `/api/v1/business-versions/${workspace.versionId}/authoring-jobs`,
      {
        headers: { 'idempotency-key': 'semantic-e2e-repair' },
        body: {
          schema: 'nebula.ai-e2e.create-authoring-job/1.0',
          mode: 'repair',
          targetType: 'functional_module',
          targetId: module.id,
          currentUrl: 'https://example.test/',
          reason: 'E2E candidate activation',
          createdBy: 'e2e',
        },
      }
    );
    expect(job.status).toBe(201);
    const jobId = String((job.data as { id: string }).id);
    await tickUntil(() => {
      const row = db
        .prepare('SELECT state FROM authoring_amendments WHERE job_id = ?')
        .get(jobId) as { state?: string } | undefined;
      return row?.state === 'candidate_ready';
    });
    const amendment = db
      .prepare('SELECT id FROM authoring_amendments WHERE job_id = ?')
      .get(jobId) as { id: string };
    const queued = await request('POST', `/api/v1/authoring-amendments/${amendment.id}/commands`, {
      body: { action: 'queue_at_safe_boundary' },
    });
    expect(queued.status).toBe(200);
    await tickUntil(() => {
      const row = db
        .prepare('SELECT state FROM authoring_amendments WHERE id = ?')
        .get(amendment.id) as { state: string };
      return row.state === 'activated';
    });
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(module.id)
    ).not.toEqual({ id: module.revision_id });

    const refusedRun = await request('POST', `/api/v1/projects/${workspace.id}/runs`, {
      headers: { 'idempotency-key': 'semantic-e2e-unverified-run' },
      body: {
        schema: 'nebula.ai-e2e.create-run/1.0',
        businessVersionId: workspace.versionId,
        scenarioRevisionId: String(
          (
            db
              .prepare(
                `SELECT revisions.id FROM semantic_test_scenario_revisions AS revisions
                 JOIN semantic_test_scenarios AS scenarios ON scenarios.id = revisions.test_scenario_id
                 WHERE scenarios.business_version_id = ? AND revisions.lifecycle = 'current'`
              )
              .get(workspace.versionId) as { id: string }
          ).id
        ),
        deploymentRevisionId: workspace.deploymentRevisionId,
        inputs: {},
      },
    });
    expect(refusedRun.status).toBe(400);

    const executable = markStarterGraphVerified(
      workspace.versionId,
      workspace.deploymentRevisionId
    );
    const run = await request('POST', `/api/v1/projects/${workspace.id}/runs`, {
      headers: { 'idempotency-key': 'semantic-e2e-run' },
      body: {
        schema: 'nebula.ai-e2e.create-run/1.0',
        businessVersionId: workspace.versionId,
        scenarioRevisionId: executable.scenarioRevisionId,
        deploymentRevisionId: workspace.deploymentRevisionId,
        inputs: {},
      },
    });
    expect(run.status).toBe(201);
    const runView = run.data as { id: string; stateVersion: number };
    const started = await request('POST', `/api/v1/runs/${runView.id}/commands`, {
      headers: {
        'idempotency-key': 'semantic-e2e-run-start',
        'if-match': String(runView.stateVersion),
      },
      body: {
        schema: 'nebula.ai-e2e.run-command/1.0',
        action: 'start',
        createdBy: 'e2e',
      },
    });
    expect(started.status).toBe(200);
    await tickUntil(() => {
      const row = db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(runView.id) as {
        lifecycle: string;
      };
      return row.lifecycle === 'completed';
    });

    expect(
      db.prepare('SELECT lifecycle, outcome FROM test_runs WHERE id = ?').get(runView.id)
    ).toEqual({
      lifecycle: 'completed',
      outcome: 'passed',
    });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM evidence_manifests
           WHERE run_id = ? AND status = 'sealed'`
        )
        .get(runView.id)
    ).toEqual({ count: 1 });
    expect(executor.operations).toContain('page_state');
    expect(await fetch(`${aiE2eUrl}/api/projects/${workspace.id}`)).toMatchObject({ status: 404 });
  });

  it('stops an unknown browser outcome for an operator decision without replaying it', async () => {
    const created = await request('POST', '/api/v1/projects', {
      headers: { 'idempotency-key': 'semantic-e2e-unknown-project' },
      body: {
        name: 'Unknown Outcome E2E',
        versionKey: 'v1',
        versionName: 'Version 1',
        targetOrigin: 'https://example.test',
        environment: 'test',
        prd: { format: 'markdown', content: '# Preserve unknown outcomes' },
        createdBy: 'e2e',
      },
    });
    expect(created.status).toBe(201);
    const workspace = created.data as {
      id: string;
      versionId: string;
      deploymentRevisionId: string;
    };
    const executable = markStarterGraphVerified(
      workspace.versionId,
      workspace.deploymentRevisionId
    );
    executor.formalResult = 'outcome_unknown';
    try {
      const run = await request('POST', `/api/v1/projects/${workspace.id}/runs`, {
        headers: { 'idempotency-key': 'semantic-e2e-unknown-run' },
        body: {
          schema: 'nebula.ai-e2e.create-run/1.0',
          businessVersionId: workspace.versionId,
          scenarioRevisionId: executable.scenarioRevisionId,
          deploymentRevisionId: workspace.deploymentRevisionId,
          inputs: {},
        },
      });
      expect(run.status).toBe(201);
      const runView = run.data as { id: string; stateVersion: number };
      expect(
        (
          await request('POST', `/api/v1/runs/${runView.id}/commands`, {
            headers: {
              'idempotency-key': 'semantic-e2e-unknown-start',
              'if-match': String(runView.stateVersion),
            },
            body: {
              schema: 'nebula.ai-e2e.run-command/1.0',
              action: 'start',
              createdBy: 'e2e',
            },
          })
        ).status
      ).toBe(200);
      const db = DatabaseManager.getInstance().getDatabase();
      await tickUntil(() => {
        const todo = db.prepare('SELECT state FROM run_todos WHERE run_id = ?').get(runView.id) as
          | { state: string }
          | undefined;
        return todo?.state === 'waiting_decision';
      });
      const agentCount = (
        db
          .prepare(
            `SELECT COUNT(*) AS count FROM external_task_links
             WHERE run_id = ? AND service = 'ai_chat_service' AND kind = 'agent_task'`
          )
          .get(runView.id) as { count: number }
      ).count;
      for (let index = 0; index < 12; index += 1) await coordinator.tick();
      expect(
        db.prepare('SELECT lifecycle, outcome FROM test_runs WHERE id = ?').get(runView.id)
      ).toEqual({ lifecycle: 'running', outcome: null });
      expect(
        db
          .prepare(
            `SELECT category, status FROM decision_requests
             WHERE run_id = ? AND todo_id IS NOT NULL`
          )
          .get(runView.id)
      ).toEqual({ category: 'outcome_unknown', status: 'open' });
      expect(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS count FROM external_task_links
               WHERE run_id = ? AND service = 'ai_chat_service' AND kind = 'agent_task'`
            )
            .get(runView.id) as { count: number }
        ).count
      ).toBe(agentCount);
    } finally {
      executor.formalResult = 'succeeded';
    }
  });

  async function request(
    method: 'GET' | 'POST',
    path: string,
    options: { headers?: Record<string, string>; body?: unknown } = {}
  ): Promise<{ status: number; data: unknown; meta?: Record<string, unknown> }> {
    const response = await fetch(new URL(path, aiE2eUrl), {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = (await response.json()) as { data?: unknown; meta?: Record<string, unknown> };
    return { status: response.status, data: payload.data, meta: payload.meta };
  }

  async function tickUntil(predicate: () => boolean, limit = 80): Promise<void> {
    for (let index = 0; index < limit; index += 1) {
      await coordinator.tick();
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const db = DatabaseManager.getInstance().getDatabase();
    const agentLinks = db
      .prepare("SELECT external_id FROM external_task_links WHERE kind = 'agent_task'")
      .all() as Array<{ external_id: string }>;
    const diagnostics = {
      jobs: db.prepare('SELECT lifecycle, outcome FROM authoring_jobs').all(),
      tasks: db.prepare('SELECT state, current_attempt_id FROM authoring_tasks').all(),
      attempts: db.prepare('SELECT status, error_json FROM authoring_attempts').all(),
      amendments: db.prepare('SELECT state FROM authoring_amendments').all(),
      outbox: db
        .prepare(
          'SELECT target_service, command_type, status, last_error_json FROM integration_outbox'
        )
        .all(),
      agentTasks: agentLinks.map(({ external_id }) => agentTaskService.get(external_id)),
    };
    throw new Error(
      `Semantic coordinator did not reach the expected state: ${JSON.stringify(diagnostics)}`
    );
  }
});

class DeterministicBrowserExecutor implements AgentTaskExecutor {
  authoringCandidate?: {
    moduleId: string;
    baseRevisionId: string;
    pageId: string;
    payload: unknown;
  };
  readonly operations: string[] = [];
  formalResult: 'succeeded' | 'outcome_unknown' = 'succeeded';

  constructor(private readonly proxyUrl: string) {}

  async execute(context: AgentTaskExecutionContext): Promise<AgentTaskExecutionResult> {
    const toolCalls = await this.executeAuthorizedSteps(context);
    const clientTaskId = context.request.clientTaskId;
    const output = clientTaskId.startsWith('authoring-verification:')
      ? {
          result: 'succeeded',
          reasonClass: 'acceptance_passed',
          summary: 'Candidate passed the real browser verification',
        }
      : clientTaskId.startsWith('authoring:')
        ? this.authoringOutput()
        : {
            result: this.formalResult,
            reasonClass:
              this.formalResult === 'succeeded'
                ? 'acceptance_passed'
                : 'connection_lost_after_dispatch',
            summary:
              this.formalResult === 'succeeded'
                ? 'All semantic steps passed'
                : 'The browser outcome cannot be proven',
            confirmedOutputsJson: '{}',
          };
    return {
      output,
      terminationReason: 'stop',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        modelTurns: 1,
        toolCalls: toolCalls.length,
      },
      toolCalls,
    };
  }

  private authoringOutput() {
    if (!this.authoringCandidate) throw new Error('Authoring candidate was not configured');
    return {
      status: 'candidate_ready',
      summary: 'Generated deterministic module candidate',
      category: 'repair',
      proposalsJson: JSON.stringify([
        {
          assetType: 'functional_module',
          assetId: this.authoringCandidate.moduleId,
          baseRevisionId: this.authoringCandidate.baseRevisionId,
          candidatePayload: this.authoringCandidate.payload,
          category: 'repair',
          reason: 'E2E candidate',
          targetUrl: 'https://example.test/',
          targetPageDefinitionId: this.authoringCandidate.pageId,
          targetFunctionalModuleId: this.authoringCandidate.moduleId,
        },
      ]),
      validationPlanJson: JSON.stringify({ strategy: 'real_browser_verification' }),
      potentialSideEffectsJson: '{}',
    };
  }

  private async executeAuthorizedSteps(
    context: AgentTaskExecutionContext
  ): Promise<AgentTaskToolCallSummary[]> {
    const binding = context.request.browserBinding;
    const constraints = context.request.toolPolicy.constraints?.[
      'browser-control.operation_execute'
    ] as { steps?: Array<Record<string, unknown>> } | undefined;
    if (!binding || !constraints?.steps) return [];
    const summaries: AgentTaskToolCallSummary[] = [];
    for (const step of constraints.steps) {
      context.beforeToolCall();
      const operationId = randomUUID();
      const operation = String(step.operation);
      const response = await fetch(new URL('/mcp', this.proxyUrl), {
        method: 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: randomUUID(),
          method: 'tools/call',
          params: {
            name: 'browser-control.operation_execute',
            arguments: {
              sessionId: binding.browserSessionId,
              leaseId: binding.browserLeaseId,
              leaseToken: binding.browserLeaseToken,
              tabId: binding.tabId,
              request: {
                schema: 'nebula.browser.operation/1.0',
                operationId,
                leaseSequence: binding.browserLeaseSequence,
                deadlineAt: new Date(Date.now() + 30_000).toISOString(),
                presentation: { animation: 'off' },
                kind: step.kind,
                operation,
                ...(step.target ? { target: step.target } : {}),
                ...(step.args ? { args: step.args } : {}),
                ...(step.capture ? { capture: step.capture } : {}),
              },
            },
          },
        }),
        signal: context.signal,
      });
      const envelope = (await response.json()) as {
        result?: { content?: Array<{ type: string; text?: string }> };
        error?: unknown;
      };
      if (!response.ok || envelope.error) throw new Error(JSON.stringify(envelope.error));
      const text = envelope.result?.content?.find((item) => item.type === 'text')?.text;
      const record = JSON.parse(text ?? '{}') as { status?: string };
      if (record.status !== 'succeeded') throw new Error(`Browser operation failed: ${text}`);
      this.operations.push(operation);
      summaries.push({
        toolCallId: `e2e-${operationId}`,
        toolName: 'browser-control.operation_execute',
        status: 'succeeded',
        stepId: String(step.stepId),
        operationId,
        operation,
      });
    }
    return summaries;
  }
}

function markStarterGraphVerified(versionId: string, deploymentRevisionId: string) {
  const database = DatabaseManager.getInstance();
  const db = database.getDatabase();
  const script = db
    .prepare(
      `SELECT scripts.id, revisions.id AS revision_id
       FROM functional_scripts AS scripts
       JOIN functional_script_revisions AS revisions
         ON revisions.functional_script_id = scripts.id AND revisions.lifecycle = 'current'
       WHERE scripts.business_version_id = ?`
    )
    .get(versionId) as { id: string; revision_id: string };
  const scenario = db
    .prepare(
      `SELECT scenarios.id, revisions.id AS revision_id
       FROM semantic_test_scenarios AS scenarios
       JOIN semantic_test_scenario_revisions AS revisions
         ON revisions.test_scenario_id = scenarios.id AND revisions.lifecycle = 'current'
       WHERE scenarios.business_version_id = ?`
    )
    .get(versionId) as { id: string; revision_id: string };
  db.prepare('UPDATE functional_script_revisions SET readiness_status = ? WHERE id = ?').run(
    'verified',
    script.revision_id
  );
  db.prepare('UPDATE semantic_test_scenario_revisions SET readiness_status = ? WHERE id = ?').run(
    'verified',
    scenario.revision_id
  );
  const assets = database.getSemanticAssetRepo();
  const verificationScope = { locale: 'en-US', viewport: 'desktop' };
  assets.recordBusinessVersionValidation({
    businessVersionId: versionId,
    deploymentRevisionId,
    assetGraphSha256: 'a'.repeat(64),
    verificationScope,
    status: 'valid',
  });
  for (const executable of [
    { assetType: 'functional_script' as const, assetId: script.id, revisionId: script.revision_id },
    { assetType: 'test_scenario' as const, assetId: scenario.id, revisionId: scenario.revision_id },
  ]) {
    assets.recordVerification({
      businessVersionId: versionId,
      assetType: executable.assetType,
      assetId: executable.assetId,
      assetRevisionId: executable.revisionId,
      deploymentRevisionId,
      verificationScope,
      dependencyClosureSha256: HASH_B,
      status: 'verified',
    });
  }
  database.getBusinessVersionRepo().setValidationStatus(versionId, 'valid');
  expect(hashValue(verificationScope)).toMatch(/^[a-f0-9]{64}$/);
  return { scenarioRevisionId: scenario.revision_id };
}

const quietLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
