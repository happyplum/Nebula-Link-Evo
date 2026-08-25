import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp as buildProxyApp } from '../../../proxy-adapter/src/server.js';
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
  const liveKitApiKey = process.env.LIVEKIT_API_KEY;
  const liveKitApiSecret = process.env.LIVEKIT_API_SECRET;
  let root: string;
  let proxyApp: Awaited<ReturnType<typeof buildProxyApp>>;
  let proxyUrl: string;
  let aiChatProcess: ChildProcess;
  let aiChatUrl: string;
  let aiE2eApp: ReturnType<typeof createServer>;
  let aiE2eUrl: string;
  let coordinator: SemanticCoordinatorService;
  let journeyPlanPath: string;

  beforeAll(async () => {
    delete process.env.LIVEKIT_API_KEY;
    delete process.env.LIVEKIT_API_SECRET;
    root = await mkdtemp(join(tmpdir(), 'nebula-semantic-journey-'));
    proxyApp = await buildProxyApp({ dataDir: join(root, 'proxy'), skipBackups: true });
    proxyUrl = await proxyApp.listen({ host: '127.0.0.1', port: 0 });

    const dataDir = join(root, 'ai-chat');
    const configPath = join(root, 'config.json');
    const pluginLockPath = join(root, 'trusted-harness-plugins.lock.json');
    journeyPlanPath = join(root, 'journey-plan.json');
    await mkdir(dataDir, { recursive: true });
    await writeFile(configPath, JSON.stringify(testConfig()), 'utf8');
    await writeFile(pluginLockPath, JSON.stringify(testPluginLock(proxyUrl)), 'utf8');
    await writeJourneyPlan({ formalResult: 'succeeded' });
    const started = await startAiChatProcess({
      root,
      dataDir,
      configPath,
      pluginLockPath,
      proxyUrl,
      journeyPlanPath,
    });
    aiChatProcess = started.process;
    aiChatUrl = started.url;

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
      logger: false,
      semanticProjectService: new SemanticProjectService(database.getSemanticProjectRepo()),
      businessVersionService: new BusinessVersionService(versions),
      semanticQueryService: new SemanticQueryService(database.getSemanticQueryRepo()),
      semanticAuthoringService: authoring,
      semanticRunService: runService,
    });
    aiE2eUrl = await aiE2eApp.listen({ host: '127.0.0.1', port: 0 });
  });

  afterAll(async () => {
    await aiE2eApp?.close();
    if (aiChatProcess) await stopChild(aiChatProcess);
    await proxyApp?.close();
    DatabaseManager.resetInstance();
    await rm(root, { recursive: true, force: true });
    restoreEnvironment('LIVEKIT_API_KEY', liveKitApiKey);
    restoreEnvironment('LIVEKIT_API_SECRET', liveKitApiSecret);
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
    await writeJourneyPlan({
      formalResult: 'succeeded',
      authoringOutput: {
        status: 'candidate_ready',
        summary: 'Generated deterministic module candidate',
        category: 'repair',
        proposalsJson: JSON.stringify([
          {
            assetType: 'functional_module',
            assetId: module.id,
            baseRevisionId: module.revision_id,
            candidatePayload: { ...modulePayload, goal: 'Verified by the product E2E journey' },
            category: 'repair',
            reason: 'E2E candidate',
            targetUrl: 'https://example.test/',
            targetPageDefinitionId: modulePayload.primaryPageDefinitionId,
            targetFunctionalModuleId: module.id,
          },
        ]),
        validationPlanJson: JSON.stringify({ strategy: 'real_browser_verification' }),
        potentialSideEffectsJson: '{}',
      },
    });

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
    const formalTaskId = String(
      (
        db
          .prepare(
            `SELECT external_id FROM external_task_links
             WHERE run_id = ? AND service = 'ai_chat_service' AND kind = 'agent_task'`
          )
          .get(runView.id) as { external_id: string }
      ).external_id
    );
    const formalTask = await new AgentTaskClient({
      baseUrl: aiChatUrl,
      timeoutMs: 30_000,
    }).getTask(formalTaskId);
    if (formalTask.toolCalls.length === 0) {
      throw new Error(
        `Formal Agent task executed no browser operation: ${JSON.stringify(formalTask)}`
      );
    }
    expect(formalTask).toMatchObject({
      status: 'completed',
      toolCalls: expect.arrayContaining([
        expect.objectContaining({ operation: 'page_state', status: 'succeeded' }),
        expect.objectContaining({ operation: 'url', status: 'succeeded' }),
      ]),
    });
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
    await writeJourneyPlan({ formalResult: 'outcome_unknown' });
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
      await writeJourneyPlan({ formalResult: 'succeeded' });
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

  async function tickUntil(predicate: () => boolean, timeoutMs = 20_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
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
      agentTasks: await Promise.all(
        agentLinks.map(({ external_id }) =>
          new AgentTaskClient({ baseUrl: aiChatUrl, timeoutMs: 30_000 })
            .getTask(external_id)
            .catch((error: unknown) => ({ external_id, error: String(error) }))
        )
      ),
    };
    throw new Error(
      `Semantic coordinator did not reach the expected state: ${JSON.stringify(diagnostics)}`
    );
  }

  async function writeJourneyPlan(plan: Record<string, unknown>): Promise<void> {
    await writeFile(journeyPlanPath, JSON.stringify(plan), 'utf8');
  }
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
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

function testConfig(): Record<string, unknown> {
  return {
    version: '2.0',
    providers: {
      test: {
        enabled: true,
        apiKey: '{E2E_TEST_API_KEY}',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: {
          decision: { type: 'decision', capabilities: ['decision'], maxTokens: 24_000 },
          vision: { type: 'vision', capabilities: ['vision'], maxTokens: 8_000 },
        },
      },
    },
    defaults: { mode: 'unified', decision: 'test/decision', vision: 'test/vision' },
    settings: {
      timeout: 30_000,
      maxRetries: 1,
      temperature: 0,
      maxTokens: 24_000,
      maxSteps: 20,
      contextWindowTokens: 40_000,
    },
    mcp: { enabled: false, servers: {} },
  };
}

function testPluginLock(proxyUrl: string): Record<string, unknown> {
  return {
    schema: 'nebula.ai.trusted-harness-plugins/1.0',
    abi: { cordis: '4.0.1', deepseekHarness: '0.1.1-rc.2' },
    plugins: [],
    mcp: [
      {
        transport: 'streamable-http',
        serverName: 'gateway',
        url: new URL('/mcp', proxyUrl).toString(),
        headers: {},
      },
    ],
  };
}

async function startAiChatProcess(options: {
  root: string;
  dataDir: string;
  configPath: string;
  pluginLockPath: string;
  proxyUrl: string;
  journeyPlanPath: string;
}): Promise<{ process: ChildProcess; url: string }> {
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./ai-chat-harness-process.mjs', import.meta.url))],
    {
      cwd: options.root,
      env: {
        ...process.env,
        AI_CHAT_E2E_CONFIG_PATH: options.configPath,
        AI_CHAT_E2E_DATA_DIR: options.dataDir,
        AI_CHAT_E2E_PLUGIN_LOCK_PATH: options.pluginLockPath,
        AI_E2E_JOURNEY_PLAN_PATH: options.journeyPlanPath,
        PROXY_ADAPTER_URL: options.proxyUrl,
        E2E_TEST_API_KEY: 'deterministic-test-key',
        TEST_MODE: 'true',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }
  );
  return { process: child, url: await waitForReady(child) };
}

async function waitForReady(child: ChildProcess): Promise<string> {
  let logs = '';
  let stdout = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`ai-chat-service startup timed out: ${logs}`)),
      30_000
    );
    const failed = () => {
      clearTimeout(timeout);
      reject(new Error(`ai-chat-service exited before ready: ${logs}`));
    };
    child.once('exit', failed);
    child.stderr?.on('data', (chunk) => (logs += String(chunk)));
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      logs += text;
      stdout += text;
      for (const line of stdout.split(/\r?\n/u)) {
        if (!line.startsWith('E2E_AI_CHAT_READY ')) continue;
        clearTimeout(timeout);
        child.off('exit', failed);
        resolve(
          String((JSON.parse(line.slice('E2E_AI_CHAT_READY '.length)) as { url: string }).url)
        );
        return;
      }
      stdout = stdout.slice(Math.max(0, stdout.lastIndexOf('\n') + 1));
    });
  });
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await exited;
}
