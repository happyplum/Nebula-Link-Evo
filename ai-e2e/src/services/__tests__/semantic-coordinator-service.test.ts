import type {
  PersistedAgentTaskRequest,
  AgentTaskCommandRequest,
  AgentTaskCommandResult,
  AgentTaskEventRecord,
  AgentTaskView,
  CreateAgentTaskRequest,
} from '@nebula-link-evo/shared/types/agent-task';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { up as up014 } from '../../database/migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../database/migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../database/migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../database/migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../database/migrations/018-authoring-amendments.js';
import { AuthoringAmendmentRepository } from '../../database/repositories/authoring-amendment-repository.js';
import type { AgentActivityRepository } from '../../database/repositories/agent-activity-repository.js';
import { BusinessVersionRepository } from '../../database/repositories/business-version-repository.js';
import { SemanticAssetRepository } from '../../database/repositories/semantic-asset-repository.js';
import { SemanticCoordinatorRepository } from '../../database/repositories/semantic-coordinator-repository.js';
import { SemanticEvidenceRepository } from '../../database/repositories/semantic-evidence-repository.js';
import { hashValue } from '../../database/repositories/semantic-repository-utils.js';
import { SemanticRunControlRepository } from '../../database/repositories/semantic-run-control-repository.js';
import { SemanticQueryRepository } from '../../database/repositories/semantic-query-repository.js';
import { SemanticWorkflowRepository } from '../../database/repositories/semantic-workflow-repository.js';
import { functionalScriptFixture } from '../../test-support/functional-script-fixture.js';

import type { AgentTaskClientPort } from '../../infrastructure/agent-task-client.js';
import { MemoryCoordinatorSecretStore } from '../../infrastructure/coordinator-secret-store.js';
import { IntegrationClientError } from '../../infrastructure/integration-client-error.js';
import type {
  BrowserExecutionCapabilities,
  BrowserLeaseView,
  BrowserOperationRecord,
  BrowserSessionEventRecord,
  BrowserSessionView,
  CreateBrowserLeaseRequest,
} from '@nebula-link-evo/shared/types/browser-execution';
import type { SemanticBrowserClientPort } from '../../infrastructure/semantic-browser-client.js';
import { SemanticArtifactStore } from '../../infrastructure/semantic-artifact-store.js';
import {
  desiredAgentCommand,
  SemanticCoordinatorService,
} from '../semantic-coordinator-service.js';
import { SemanticAuthoringCandidateService } from '../semantic-authoring-candidate-service.js';
import { SemanticAuthoringService } from '../semantic-authoring-service.js';
import {
  AGENT_STREAM_EVENT_SCHEMA,
  type AgentStreamEventV1,
} from '@nebula-link-evo/shared/types/agent-stream';

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
  let evidencePath: string | undefined;

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

  afterEach(async () => {
    db.close();
    if (evidencePath) await rm(evidencePath, { recursive: true, force: true });
    evidencePath = undefined;
  });

  async function collectEvidence(
    context: 'run' | 'authoring',
    browser: FakeBrowserClient,
    toolCalls: AgentTaskView['toolCalls'],
    fixture = createFixture(db, assets),
    agentTasks = new FakeAgentTaskClient(
      { status: 'no_change', summary: '资产无需修改' },
      { toolCalls },
      { toolCalls }
    )
  ) {
    let contextId: string;
    if (context === 'run') {
      const created = runs.createFormalRun({
        projectId: 'project-1',
        businessVersionId: fixture.versionId,
        clientRunId: 'evidence-run',
        scenarioRevisionId: fixture.scenarioRevisionId,
        deploymentRevisionId: fixture.deploymentRevisionId,
        inputs: {},
      });
      contextId = created.id;
      runs.command({
        commandId: 'start-evidence-run',
        runId: contextId,
        action: 'start',
        expectedStateVersion: 2,
        createdBy: 'operator',
      });
    } else {
      const authoring = new SemanticAuthoringService(
        workflows,
        assets,
        new AuthoringAmendmentRepository(db, assets),
        new BusinessVersionRepository(db)
      );
      contextId = authoring.createJob({
        businessVersionId: fixture.versionId,
        mode: 'repair',
        idempotencyKey: 'evidence-authoring',
        targetType: 'functional_module',
        targetId: fixture.moduleId,
        currentUrl: 'https://test.example/account',
        reason: '检查证据采集',
        createdBy: 'operator',
      }).id;
    }
    const temporaryRoot = path.resolve('..', '.tmp');
    await mkdir(temporaryRoot, { recursive: true });
    evidencePath ??= await mkdtemp(path.join(temporaryRoot, 't6-evidence-'));
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks,
      browser,
      secretStore: new MemoryCoordinatorSecretStore(),
      artifactStore: new SemanticArtifactStore(evidencePath),
      authoringCandidates: new SemanticAuthoringCandidateService(
        new SemanticQueryRepository(db, new BusinessVersionRepository(db)),
        assets,
        new AuthoringAmendmentRepository(db, assets)
      ),
    });
    for (let index = 0; index < 16; index += 1) await coordinator.tick();
    return db
      .prepare('SELECT * FROM evidence_manifests WHERE context_type = ? AND context_id = ?')
      .get(context, contextId) as {
      id: string;
      context_id: string;
      todo_id: string | null;
      status: string;
      completeness: string;
      manifest_json: string;
      manifest_sha256: string;
    };
  }

  const evidenceCall = (
    operationId: string,
    stepId = operationId
  ): AgentTaskView['toolCalls'][number] => ({
    toolCallId: `call-${stepId}`,
    toolName: 'browser-control.operation_execute',
    status: 'succeeded',
    stepId,
    operationId,
    operation: 'page_state',
  });
  const evidenceArtifact = (id: string) => {
    const bytes = Buffer.from('shared evidence bytes');
    return {
      id,
      kind: 'screenshot',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: 'image/png',
      bytes,
    };
  };

  describe.each(['run', 'authoring'] as const)('%s 浏览器证据', (context) => {
    it.each(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'outcome_unknown'] as const)(
      '按操作真实 %s 状态封存完整性与外部终态，并保留可下载 artifact',
      async (status) => {
        const browser = new FakeBrowserClient();
        browser.operationStatus = status;
        browser.artifact = evidenceArtifact('artifact-state');
        const manifest = await collectEvidence(context, browser, [evidenceCall('operation-state')]);
        const terminal = !['queued', 'running'].includes(status);
        expect(manifest).toMatchObject({
          status: 'sealed',
          completeness: terminal ? 'complete' : 'partial',
        });
        expect(hashValue(JSON.parse(manifest.manifest_json))).toBe(manifest.manifest_sha256);
        const operationLink = db
          .prepare(
            "SELECT * FROM external_task_links WHERE kind = 'browser_operation' AND external_id = ?"
          )
          .get('operation-state') as Record<string, unknown>;
        expect(operationLink).toMatchObject({
          context_type: context,
          context_id: manifest.context_id,
          external_state: status,
        });
        expect(Boolean(operationLink.terminal_at)).toBe(terminal);
        expect(
          operationLink[context === 'run' ? 'page_task_id' : 'authoring_task_id']
        ).toBeTruthy();
        const operationItem = db
          .prepare(
            "SELECT inline_json, integrity_sha256 FROM evidence_items WHERE manifest_id = ? AND item_type = 'operation_result'"
          )
          .get(manifest.id) as { inline_json: string; integrity_sha256: string };
        expect(hashValue(JSON.parse(operationItem.inline_json))).toBe(
          operationItem.integrity_sha256
        );
        expect(operationLink.result_sha256).toBe(operationItem.integrity_sha256);
        const artifact = db.prepare('SELECT * FROM artifact_objects').get() as Record<
          string,
          unknown
        >;
        expect(artifact).toMatchObject({
          sha256: browser.artifact.sha256,
          ref_count: 1,
          sensitivity: 'restricted',
          redaction_status: 'pending',
        });
        expect(await readFile(String(artifact.storage_key))).toEqual(browser.artifact.bytes);
        expect(
          db.prepare("SELECT result_ref FROM external_task_links WHERE kind = 'artifact'").get()
        ).toEqual({ result_ref: artifact.id });
        const audit = db
          .prepare(
            "SELECT metadata_json FROM evidence_items WHERE manifest_id = ? AND item_type = 'agent_audit'"
          )
          .get(manifest.id) as { metadata_json: string };
        expect(
          JSON.parse(audit.metadata_json)[context === 'run' ? 'pageTaskId' : 'authoringTaskId']
        ).toBeTruthy();
        expect(Boolean(manifest.todo_id)).toBe(context === 'run');
        const attempt = db
          .prepare(
            context === 'run'
              ? 'SELECT evidence_manifest_id FROM execution_attempts WHERE run_id = ?'
              : 'SELECT evidence_manifest_id FROM authoring_attempts WHERE job_id = ?'
          )
          .get(manifest.context_id);
        expect(attempt).toEqual({ evidence_manifest_id: manifest.id });
      }
    );

    it('operation 查询失败时保留其他操作、原始对象和 Agent 审计', async () => {
      const browser = new FakeBrowserClient();
      browser.operationErrors.set('missing-operation', new Error('lookup failed'));
      browser.artifact = evidenceArtifact('available-artifact');
      const manifest = await collectEvidence(context, browser, [
        evidenceCall('missing-operation'),
        evidenceCall('available-operation'),
      ]);
      expect(manifest.completeness).toBe('partial');
      expect(
        db
          .prepare('SELECT item_type FROM evidence_items WHERE manifest_id = ? ORDER BY item_type')
          .all(manifest.id)
      ).toEqual([
        { item_type: 'agent_audit' },
        { item_type: 'operation_result' },
        { item_type: 'screenshot' },
      ]);
    });

    it('单个 artifact 下载失败时继续保留同一操作的后续 artifact', async () => {
      const browser = new FakeBrowserClient();
      browser.artifacts = [
        evidenceArtifact('unavailable-artifact'),
        evidenceArtifact('available-artifact'),
      ];
      browser.artifactErrors.set('unavailable-artifact', new Error('download failed'));
      const manifest = await collectEvidence(context, browser, [
        evidenceCall('operation-artifacts'),
      ]);
      expect(manifest.completeness).toBe('partial');
      expect(
        db
          .prepare(
            "SELECT metadata_json FROM evidence_items WHERE manifest_id = ? AND item_type = 'screenshot'"
          )
          .all(manifest.id)
      ).toEqual([
        {
          metadata_json: JSON.stringify({
            captureKind: 'screenshot',
            externalArtifactId: 'available-artifact',
          }),
        },
      ]);
    });

    it('相同内容只登记一个对象，但保留各步骤及 operation 的引用', async () => {
      const browser = new FakeBrowserClient();
      browser.artifact = evidenceArtifact('repeated-artifact');
      const manifest = await collectEvidence(context, browser, [
        evidenceCall('operation-one', 'step-one'),
        evidenceCall('operation-one', 'step-two'),
        evidenceCall('operation-two', 'step-three'),
      ]);
      expect(manifest.completeness).toBe('complete');
      expect(db.prepare('SELECT sha256, ref_count FROM artifact_objects').all()).toEqual([
        { sha256: browser.artifact.sha256, ref_count: 3 },
      ]);
      expect(
        db
          .prepare(
            "SELECT step_id, browser_operation_id FROM evidence_items WHERE manifest_id = ? AND item_type = 'screenshot' ORDER BY step_id"
          )
          .all(manifest.id)
      ).toEqual([
        { step_id: 'step-one', browser_operation_id: 'operation-one' },
        { step_id: 'step-three', browser_operation_id: 'operation-two' },
        { step_id: 'step-two', browser_operation_id: 'operation-one' },
      ]);
    });

    it('拒绝哈希不符的原件并继续登记后续 DOM snapshot', async () => {
      const browser = new FakeBrowserClient();
      browser.artifacts = [
        { ...evidenceArtifact('corrupt-artifact'), sha256: HASH_B },
        { ...evidenceArtifact('dom-artifact'), kind: 'dom_snapshot', mimeType: 'application/json' },
      ];
      const manifest = await collectEvidence(context, browser, [
        evidenceCall('operation-integrity'),
      ]);
      expect(manifest.completeness).toBe('partial');
      expect(
        db.prepare('SELECT sha256, media_type, ref_count FROM artifact_objects').all()
      ).toEqual([
        { sha256: browser.artifacts[1]!.sha256, media_type: 'application/json', ref_count: 1 },
      ]);
      expect(
        db
          .prepare('SELECT item_type FROM evidence_items WHERE artifact_object_id IS NOT NULL')
          .all()
      ).toEqual([{ item_type: 'dom_snapshot' }]);
      expect(
        db.prepare("SELECT external_id FROM external_task_links WHERE kind = 'artifact'").all()
      ).toEqual([{ external_id: 'dom-artifact' }]);
    });
  });

  it('Authoring 与 Run 的独立 manifest 复用同内容对象且保留各自引用', async () => {
    const fixture = createFixture(db, assets);
    const runCalls = [evidenceCall('run-shared-content')];
    const authoringCalls = [evidenceCall('authoring-shared-content')];
    const agent = new FakeAgentTaskClient(
      { status: 'no_change', summary: '资产无需修改' },
      { toolCalls: runCalls },
      { toolCalls: authoringCalls }
    );
    const browser = new FakeBrowserClient();
    browser.artifact = evidenceArtifact('authoring-artifact');
    const authoringManifest = await collectEvidence(
      'authoring',
      browser,
      authoringCalls,
      fixture,
      agent
    );
    browser.sessionId = '10000000-0000-4000-8000-000000000009';
    browser.artifact = evidenceArtifact('run-artifact');
    const runManifest = await collectEvidence('run', browser, runCalls, fixture, agent);
    expect(authoringManifest.completeness).toBe('complete');
    expect(runManifest.completeness).toBe('complete');
    expect(db.prepare('SELECT sha256, ref_count FROM artifact_objects').all()).toEqual([
      { sha256: browser.artifact.sha256, ref_count: 2 },
    ]);
    const items = db
      .prepare(
        'SELECT manifest_id, artifact_object_id FROM evidence_items WHERE artifact_object_id IS NOT NULL'
      )
      .all() as Array<{ manifest_id: string; artifact_object_id: string }>;
    expect(items.map((item) => item.manifest_id)).toEqual(
      expect.arrayContaining([authoringManifest.id, runManifest.id])
    );
    expect(new Set(items.map((item) => item.artifact_object_id)).size).toBe(1);
    expect(
      db
        .prepare(
          "SELECT context_type, context_id, external_id FROM external_task_links WHERE kind = 'artifact' ORDER BY context_type"
        )
        .all()
    ).toEqual([
      {
        context_type: 'authoring',
        context_id: authoringManifest.context_id,
        external_id: 'authoring-artifact',
      },
      { context_type: 'run', context_id: runManifest.context_id, external_id: 'run-artifact' },
    ]);
  });

  describe('精确授权的派发竞态与恢复', () => {
    function harness() {
      const fixture = createFixture(db, assets, true);
      const browser = new FakeBrowserClient();
      const agent = new FakeAgentTaskClient(undefined, {
        status: 'paused',
        completedAt: undefined,
      });
      const secrets = new MemoryCoordinatorSecretStore();
      const amendments = new AuthoringAmendmentRepository(db, assets);
      const options = {
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        agentTasks: agent,
        browser,
        secretStore: secrets,
        authoringCandidates: new SemanticAuthoringCandidateService(
          new SemanticQueryRepository(db, new BusinessVersionRepository(db)),
          assets,
          amendments
        ),
        artifactStore: { persist: async () => ({ storageKey: 'unused', sizeBytes: 0 }) } as never,
      };
      return {
        fixture,
        browser,
        agent,
        secrets,
        amendments,
        options,
        coordinator: new SemanticCoordinatorService(options),
      };
    }
    function startRun(fixture: ReturnType<typeof createFixture>) {
      const run = runs.createFormalRun({
        projectId: 'project-1',
        businessVersionId: fixture.versionId,
        clientRunId: 'policy-race',
        scenarioRevisionId: fixture.scenarioRevisionId,
        deploymentRevisionId: fixture.deploymentRevisionId,
        inputs: {},
      });
      runs.answerDecision({
        runId: run.id,
        decisionId: run.decisionId!,
        answerKey: 'approve',
        reason: '批准精确计划',
        answeredBy: 'operator',
      });
      runs.command({
        commandId: 'start-policy-race',
        runId: run.id,
        action: 'start',
        expectedStateVersion: 3,
        createdBy: 'operator',
      });
      return run.id;
    }
    function startAuthoring(h: ReturnType<typeof harness>) {
      const job = workflows.createAuthoringJob({
        projectId: 'project-1',
        businessVersionId: h.fixture.versionId,
        mode: 'repair',
        idempotencyKey: 'policy-authoring',
        stage: 'verify',
        strategyVersion: 'test/1.0',
        sourceFingerprint: HASH_A,
        input: {},
        createdBy: 'operator',
      });
      const contextId = String(job.id);
      const thread = h.amendments.createContextThread({
        jobId: contextId,
        businessVersionId: h.fixture.versionId,
        scope: {
          currentUrl: '/account',
          currentPageDefinitionId: h.fixture.pageId,
          currentFunctionalModuleId: h.fixture.moduleId,
          baseRevisionSha256: hashValue(h.fixture.modulePayload),
          visibleScenarioIds: [],
        },
        createdBy: 'operator',
      });
      const revision = assets.createRevision({
        assetType: 'functional_script',
        assetId: h.fixture.scriptId,
        businessVersionId: h.fixture.versionId,
        schemaId: 'nebula.ai-e2e.functional-script/1.0',
        payload: h.fixture.scriptPayload,
        validationStatus: 'valid',
        changeReason: '验证候选',
        createdByType: 'child_agent',
        supersedesRevisionId: h.fixture.scriptRevisionId,
        primaryPageRevisionId: h.fixture.pageRevisionId,
      });
      const candidate = h.amendments.createAmendment({
        jobId: contextId,
        threadId: thread.id,
        idempotencyKey: 'policy-candidate',
        reason: '验证候选',
        category: 'script',
        changes: [
          {
            assetType: 'functional_script',
            assetId: h.fixture.scriptId,
            baseRevisionId: h.fixture.scriptRevisionId,
            baseRevisionSha256: hashValue(h.fixture.scriptPayload),
            candidateRevisionId: revision.id,
            targetPageDefinitionId: h.fixture.pageId,
            targetFunctionalModuleId: h.fixture.moduleId,
            targetUrl: '/account',
            category: 'script',
            diff: {},
          },
        ],
        validationPlan: { checks: ['browser'] },
        createdBy: 'operator',
      }).amendment;
      h.amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId: candidate.decisionIds[0]!,
        answer: 'approve',
        reason: '批准精确候选',
        answeredBy: 'operator',
      });
      h.amendments.queueAtSafeBoundary(candidate.id);

      return contextId;
    }
    async function untilOutbox(coordinator: SemanticCoordinatorService, command: string) {
      for (let index = 0; index < 12; index += 1) {
        if (
          db
            .prepare(
              "SELECT id FROM integration_outbox WHERE command_type = ? AND status = 'pending'"
            )
            .get(command)
        )
          return;
        await coordinator.tick();
      }
      throw new Error(
        `Missing pending ${command}: ${JSON.stringify(db.prepare('SELECT command_type,status,last_error_json FROM integration_outbox').all())}`
      );
    }
    function revoke(contextId: string) {
      db.prepare(
        "UPDATE side_effect_approval_grants SET status = 'revoked', revoked_at = ? WHERE context_id = ? AND status = 'active'"
      ).run(new Date().toISOString(), contextId);
    }

    describe('Authoring 租约凭据丢失恢复', () => {
      async function lostLeaseHarness(losses = 1) {
        const h = harness();
        const jobId = startAuthoring(h);
        await untilOutbox(h.coordinator, 'authoring_browser_lease.create');
        const original = db
          .prepare(
            "SELECT * FROM integration_outbox WHERE command_type = 'authoring_browser_lease.create'"
          )
          .get() as Record<string, unknown>;
        let now = new Date();
        const browser: SemanticBrowserClientPort = h.browser;
        const create = browser.createLease.bind(browser);
        const session = browser.getSession.bind(browser);
        const leases = new Map<string, BrowserLeaseView>();
        const createLease = vi
          .spyOn(browser, 'createLease')
          .mockImplementation(async (id, key, input) => {
            const previous = leases.get(key);
            if (previous) {
              return {
                lease: {
                  ...previous,
                  status: Date.parse(previous.expiresAt) > now.getTime() ? 'active' : 'expired',
                },
                tokenIssued: false,
              };
            }
            expect(
              [...leases.values()].some((lease) => Date.parse(lease.expiresAt) > now.getTime())
            ).toBe(false);
            const issued = await create(id, key, input);
            issued.lease.sequence = leases.size + 1;
            issued.lease.createdAt = now.toISOString();
            issued.lease.expiresAt = new Date(now.getTime() + 300_000).toISOString();
            leases.set(key, issued.lease);
            if (leases.size <= losses) {
              throw new IntegrationClientError(
                'proxy-adapter',
                'dependency_unavailable',
                '签发后响应丢失',
                true
              );
            }
            return issued;
          });
        vi.spyOn(browser, 'getSession').mockImplementation(async (id) => {
          const current = await session(id);
          return {
            ...current,
            activeLeases: current.activeLeases.filter(
              (lease) => Date.parse(lease.expiresAt) > now.getTime()
            ),
          };
        });
        const options = { ...h.options, now: () => now };
        let coordinator = new SemanticCoordinatorService(options);
        await coordinator.tick();
        expect(leases.size).toBe(1);
        expect(
          h.secrets.has(`coordinator-secret://browser-lease/${leases.get(String(original.id))!.id}`)
        ).toBe(false);
        expect(h.agent.createdRequest).toBeUndefined();
        // Simulate process recovery before local confirmation or secret persistence.
        db.prepare("UPDATE integration_outbox SET status = 'dispatching' WHERE id = ?").run(
          original.id
        );
        coordinator = new SemanticCoordinatorService(options);
        return {
          ...h,
          jobId,
          original,
          leases,
          createLease,
          coordinator,
          restart: () => new SemanticCoordinatorService(options),
          expire: (key: string) => {
            now = new Date(Date.parse(leases.get(key)!.expiresAt) + 1_000);
          },
        };
      }

      it('活动旧租约无 token 时等待过期，不创建第二份控制权或 Agent', async () => {
        const h = await lostLeaseHarness();
        await h.coordinator.tick();
        const lease = h.leases.get(String(h.original.id))!;
        expect(
          db
            .prepare('SELECT status, next_attempt_at FROM integration_outbox WHERE id = ?')
            .get(h.original.id)
        ).toEqual({
          status: 'retryable_failed',
          next_attempt_at: new Date(Date.parse(lease.expiresAt) + 1_000).toISOString(),
        });
        await h.coordinator.tick();
        expect(h.leases.size).toBe(1);
        expect(h.createLease).toHaveBeenCalledTimes(2);
        expect(h.agent.createdRequest).toBeUndefined();
        expect(db.prepare('SELECT id FROM authoring_attempts').get()).toBeUndefined();
      });

      it('旧租约失效后先持久新 key，再确认旧意图；重放不双建且 Agent 关联原 Authoring task', async () => {
        const h = await lostLeaseHarness();
        await h.coordinator.tick();
        h.expire(String(h.original.id));
        const settle = evidence.settleOutbox.bind(evidence);
        const interrupted = new Error('租约恢复意图已持久化，确认前进程中断');
        const settleSpy = vi
          .spyOn(evidence, 'settleOutbox')
          .mockImplementation((id, status, result) => {
            if (id === h.original.id) {
              if (status === 'confirmed') {
                expect(
                  db
                    .prepare('SELECT status FROM integration_outbox WHERE id = ?')
                    .get(`${id}:recovery:1`)
                ).toEqual({ status: 'pending' });
              }
              // Stop both confirmation and failure handling before either can write local state.
              throw interrupted;
            }
            return settle(id, status, result);
          });
        // Replay becomes due only after the active lease expires.
        await expect(h.coordinator.tick()).rejects.toBe(interrupted);
        const lease = h.leases.get(String(h.original.id))!;
        const recoveryId = `${h.original.id}:recovery:${lease.sequence}`;
        const recovery = db
          .prepare('SELECT * FROM integration_outbox WHERE id = ?')
          .get(recoveryId);
        expect(recovery).toMatchObject({
          context_type: 'authoring',
          context_id: h.jobId,
          authoring_task_id: h.original.authoring_task_id,
          command_type: 'authoring_browser_lease.create',
          endpoint_or_tool: h.original.endpoint_or_tool,
          payload_json_redacted: h.original.payload_json_redacted,
          request_sha256: h.original.request_sha256,
          secret_binding_ref: null,
          status: 'pending',
        });
        expect(
          db
            .prepare('SELECT status, result_ref FROM integration_outbox WHERE id = ?')
            .get(h.original.id)
        ).toEqual({ status: 'dispatching', result_ref: null });
        expect(h.leases.size).toBe(1);
        settleSpy.mockRestore();
        const restarted = h.restart();
        await restarted.tick();
        expect(
          db
            .prepare('SELECT status, result_ref FROM integration_outbox WHERE id = ?')
            .get(h.original.id)
        ).toEqual({ status: 'confirmed', result_ref: lease.id });
        expect(
          db
            .prepare(
              "SELECT count(*) AS count FROM integration_outbox WHERE command_type = 'authoring_browser_lease.create'"
            )
            .get()
        ).toEqual({ count: 2 });
        await restarted.tick();
        expect(h.leases.size).toBe(2);
        expect(h.createLease.mock.calls.map((call) => call[1])).toEqual([
          h.original.id,
          h.original.id,
          h.original.id,
          h.original.id,
          recoveryId,
        ]);
        await restarted.tick();
        expect(h.agent.createdRequest?.correlation).toMatchObject({
          authoringJobId: h.jobId,
          authoringTaskId: h.original.authoring_task_id,
        });
        expect(h.agent.createdRequest?.browserBinding.browserLeaseId).toBe(
          h.leases.get(recoveryId)!.id
        );
        await restarted.tick();
        expect(db.prepare('SELECT task_id FROM authoring_attempts').all()).toEqual([
          { task_id: h.original.authoring_task_id },
        ]);
        expect(
          db
            .prepare(
              "SELECT authoring_task_id FROM external_task_links WHERE kind = 'browser_lease'"
            )
            .all()
        ).toEqual([{ authoring_task_id: h.original.authoring_task_id }]);
      });

      it('连续签发丢响应时逐代恢复，仍只有一次 Authoring attempt 和 Agent create', async () => {
        const h = await lostLeaseHarness(2);
        h.expire(String(h.original.id));
        await h.coordinator.tick();
        const secondId = `${h.original.id}:recovery:1`;
        await h.coordinator.tick();
        expect(h.leases.size).toBe(2);
        db.prepare("UPDATE integration_outbox SET status = 'dispatching' WHERE id = ?").run(
          secondId
        );
        h.expire(secondId);
        const restarted = h.restart();
        await restarted.tick();
        const thirdId = `${secondId}:recovery:2`;
        expect(
          db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get(thirdId)
        ).toEqual({ status: 'pending' });
        await restarted.tick();
        const createAgent = vi.spyOn(h.agent, 'createTask');
        await restarted.tick();
        expect(h.leases.size).toBe(3);
        expect(createAgent).toHaveBeenCalledTimes(1);
        await restarted.tick();
        expect(db.prepare('SELECT count(*) AS count FROM authoring_attempts').get()).toEqual({
          count: 1,
        });
      });

      it.each(['cancel', 'revoke'] as const)(
        '新恢复意图派发前 %s，不取得新租约或启动 Agent',
        async (action) => {
          const h = await lostLeaseHarness();
          h.expire(String(h.original.id));
          await h.coordinator.tick();
          const recoveryId = `${h.original.id}:recovery:1`;
          expect(
            db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get(recoveryId)
          ).toEqual({ status: 'pending' });
          if (action === 'revoke') revoke(h.jobId);
          else {
            const state = db
              .prepare('SELECT state_version FROM authoring_jobs WHERE id = ?')
              .get(h.jobId) as { state_version: number };
            new SemanticAuthoringService(
              workflows,
              assets,
              h.amendments,
              new BusinessVersionRepository(db)
            ).commandJob({
              commandId: 'cancel-lease-recovery',
              jobId: h.jobId,
              action: 'cancel',
              expectedStateVersion: state.state_version,
              createdBy: 'operator',
            });
          }
          await h.coordinator.tick();
          expect(h.leases.size).toBe(1);
          expect(h.agent.createdRequest).toBeUndefined();
          expect(
            db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get(recoveryId)
          ).toEqual({ status: 'cancelled' });
        }
      );
    });
    it.each(['run', 'authoring', 'authoring_error', 'authoring_revoke_retry'] as const)(
      '%s lease 返回期间撤销授权，立即撤销本次控制权且不启动 Agent',
      async (context) => {
        const h = harness();
        let contextId: string;
        if (context === 'run') contextId = startRun(h.fixture);
        else {
          contextId = startAuthoring(h);
        }
        const command =
          context === 'run' ? 'browser_lease.create' : 'authoring_browser_lease.create';
        await untilOutbox(h.coordinator, command);
        const original = h.browser.createLease.bind(h.browser);
        let entered!: () => void;
        let release!: () => void;
        const enteredPromise = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        vi.spyOn(h.browser, 'createLease').mockImplementationOnce(async (...args) => {
          entered();
          await gate;
          return original(...args);
        });
        if (context === 'authoring_revoke_retry')
          vi.spyOn(h.browser, 'revokeLease').mockRejectedValueOnce(
            new Error('revoke transport failed')
          );
        const dispatch = h.coordinator.tick();
        await enteredPromise;
        if (context === 'authoring_error')
          vi.spyOn(workflows.policy, 'requireAuthoringAuthorization').mockImplementationOnce(() => {
            throw new Error('unsupported changed verification plan');
          });
        else revoke(contextId);
        release();
        await dispatch;
        if (context === 'authoring_revoke_retry') {
          expect(
            h.secrets.has('coordinator-secret://browser-lease/10000000-0000-4000-8000-000000000001')
          ).toBe(true);
          expect(
            db
              .prepare("SELECT status FROM integration_outbox WHERE id LIKE 'policy-revoke:%'")
              .get()
          ).toEqual({ status: 'retryable_failed' });
          expect((await h.browser.getSession()).activeLeases).toHaveLength(1);
          const restarted = new SemanticCoordinatorService(h.options);
          await restarted.tick();
        }
        if (context !== 'run') {
          expect(
            db.prepare('SELECT lifecycle FROM authoring_jobs WHERE id = ?').get(contextId)
          ).toEqual({ lifecycle: 'failed' });
          expect(
            db.prepare('SELECT state FROM authoring_amendments WHERE job_id = ?').get(contextId)
          ).toEqual({ state: 'failed' });
          expect(
            db.prepare('SELECT state FROM authoring_tasks WHERE job_id = ?').get(contextId)
          ).toEqual({ state: 'blocked' });
          expect(
            db.prepare('SELECT id FROM authoring_attempts WHERE job_id = ?').get(contextId)
          ).toBeUndefined();
          for (let index = 0; index < 3; index += 1) await h.coordinator.tick();
          expect(
            h.browser.closed,
            JSON.stringify(
              db
                .prepare('SELECT command_type, status,last_error_json FROM integration_outbox')
                .all()
            )
          ).toBe(true);
          expect(
            db.prepare('SELECT state FROM browser_jobs WHERE root_context_id = ?').get(contextId)
          ).toEqual({ state: 'completed' });
        }
        expect(h.agent.createdRequest).toBeUndefined();
        expect(h.browser.revoked).toBe(true);
        expect((await h.browser.getSession()).activeLeases).toEqual([]);
        expect(
          h.secrets.has('coordinator-secret://browser-lease/10000000-0000-4000-8000-000000000001')
        ).toBe(false);
        expect(
          db.prepare('SELECT status FROM integration_outbox WHERE command_type = ?').get(command)
        ).toEqual({ status: context === 'authoring_error' ? 'terminal_failed' : 'cancelled' });
        expect(
          db.prepare("SELECT status FROM integration_outbox WHERE id LIKE 'policy-revoke:%'").get()
        ).toEqual({ status: 'confirmed' });
        expect(
          db
            .prepare(
              context === 'run'
                ? 'SELECT id FROM page_tasks'
                : "SELECT id FROM authoring_tasks WHERE state = 'running'"
            )
            .get()
        ).toBeUndefined();
      }
    );
    it('候选审批后、调度前失效不创建 session 或 lease，并记录明确失败', async () => {
      const h = harness();
      const jobId = startAuthoring(h);
      revoke(jobId);
      expect((await h.coordinator.tick()).action).toBe(
        'authoring_verification.authorization_failed'
      );
      expect(
        db.prepare('SELECT lifecycle, result_json FROM authoring_jobs WHERE id = ?').get(jobId)
      ).toEqual({
        lifecycle: 'failed',
        result_json: expect.stringContaining('side_effect_approval_required'),
      });
      expect(
        db.prepare('SELECT state FROM authoring_amendments WHERE job_id = ?').get(jobId)
      ).toEqual({ state: 'failed' });
      expect(db.prepare('SELECT id FROM integration_outbox').get()).toBeUndefined();
      expect(h.agent.createdRequest).toBeUndefined();
      expect(h.browser.capabilityCalls).toBe(0);
    });
    it.each(['revoked', 'expired', 'projection_changed', 'terminal'] as const)(
      '恢复 dispatching create 在 %s 后拒绝旧 payload 并收束任务',
      async (loss) => {
        const h = harness();
        const runId = startRun(h.fixture);
        await untilOutbox(h.coordinator, 'agent_task.create');
        db.prepare(
          "UPDATE integration_outbox SET status = 'dispatching' WHERE command_type = 'agent_task.create'"
        ).run();
        if (loss === 'projection_changed')
          db.prepare('UPDATE test_runs SET side_effect_projection_sha256 = ? WHERE id = ?').run(
            HASH_B,
            runId
          );
        else if (loss === 'terminal')
          db.prepare("UPDATE test_runs SET lifecycle = 'cancelled' WHERE id = ?").run(runId);
        else
          db.prepare(
            `UPDATE side_effect_approval_grants SET status = ?, ${loss === 'revoked' ? 'revoked_at' : 'expired_at'} = ? WHERE context_id = ?`
          ).run(loss, new Date().toISOString(), runId);
        const restarted = new SemanticCoordinatorService(h.options);
        expect(restarted.initialize().recoveredOutbox).toBe(1);
        await restarted.tick();
        expect(h.agent.createdRequest).toBeUndefined();
        expect(
          db
            .prepare(
              "SELECT status FROM integration_outbox WHERE command_type = 'agent_task.create'"
            )
            .get()
        ).toEqual({ status: 'cancelled' });
        expect(db.prepare('SELECT state FROM page_tasks WHERE run_id = ?').get(runId)).toEqual({
          state: 'interrupted',
        });
        await restarted.tick();
        expect((await h.browser.getSession()).activeLeases).toEqual([]);
      }
    );
    it.each(['session_dispatch', 'lease_enqueue', 'lease_dispatch'] as const)(
      'Authoring %s 前授权失效，封存未开始task并释放FIFO',
      async (phase) => {
        const h = harness();
        const jobId = startAuthoring(h);
        if (phase === 'session_dispatch')
          await untilOutbox(h.coordinator, 'browser_session.create');
        else {
          await untilOutbox(h.coordinator, 'browser_session.create');
          await h.coordinator.tick();
          if (phase === 'lease_dispatch')
            await untilOutbox(h.coordinator, 'authoring_browser_lease.create');
        }
        const createSession = vi.spyOn(h.browser, 'createSession');
        const createLease = vi.spyOn(h.browser, 'createLease');
        revoke(jobId);
        await h.coordinator.tick();
        expect(createSession).not.toHaveBeenCalled();
        expect(createLease).not.toHaveBeenCalled();
        expect(db.prepare('SELECT lifecycle FROM authoring_jobs WHERE id = ?').get(jobId)).toEqual({
          lifecycle: 'failed',
        });
        expect(
          db.prepare('SELECT state FROM authoring_amendments WHERE job_id = ?').get(jobId)
        ).toEqual({ state: 'failed' });
        expect(db.prepare('SELECT state FROM authoring_tasks WHERE job_id = ?').get(jobId)).toEqual(
          { state: 'blocked' }
        );
        expect(
          db.prepare('SELECT id FROM authoring_attempts WHERE job_id = ?').get(jobId)
        ).toBeUndefined();
        for (let index = 0; index < 3; index += 1) await h.coordinator.tick();
        expect(new SemanticCoordinatorRepository(db).getActiveBrowserJob()).toBeNull();
        if (phase !== 'session_dispatch') expect(h.browser.closed).toBe(true);
        expect(h.agent.createdRequest).toBeUndefined();
      }
    );
    it('恢复命令重新验证持久 task 授权；失效 resume 不派发，cancel 仍能清理', async () => {
      const h = harness();
      const runId = startRun(h.fixture);
      await untilOutbox(h.coordinator, 'agent_task.create');
      await h.coordinator.tick();
      const pageTask = db.prepare('SELECT id FROM page_tasks WHERE run_id = ?').get(runId) as {
        id: string;
      };
      evidence.enqueueOutbox({
        id: 'old-resume',
        context: { type: 'run', id: runId },
        pageTaskId: pageTask.id,
        targetService: 'ai_chat_service',
        commandType: 'agent_task.command',
        endpointOrTool: '/api/v1/agent-tasks/:taskId/commands',
        payloadRedacted: { taskId: 'agent-task-1', command: 'resume', expectedStateVersion: 2 },
      });
      db.prepare(
        "UPDATE integration_outbox SET status = 'dispatching' WHERE id = 'old-resume'"
      ).run();
      revoke(runId);
      const restarted = new SemanticCoordinatorService(h.options);
      restarted.initialize();
      // First reconcile may enqueue the same desired resume; the recovered command is still checked.
      for (let index = 0; index < 6; index += 1) {
        if (
          (
            db.prepare("SELECT status FROM integration_outbox WHERE id = 'old-resume'").get() as {
              status: string;
            }
          ).status === 'cancelled'
        )
          break;
        await restarted.tick();
      }
      expect(h.agent.commands).not.toContain('resume');
      expect(
        db.prepare("SELECT status FROM integration_outbox WHERE id = 'old-resume'").get()
      ).toEqual({ status: 'cancelled' });
      expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(runId)).toEqual({
        lifecycle: 'paused',
      });
      evidence.enqueueOutbox({
        id: 'cleanup-cancel',
        context: { type: 'run', id: runId },
        pageTaskId: pageTask.id,
        targetService: 'ai_chat_service',
        commandType: 'agent_task.command',
        endpointOrTool: '/api/v1/agent-tasks/:taskId/commands',
        payloadRedacted: { taskId: 'agent-task-1', command: 'cancel', expectedStateVersion: 2 },
      });
      for (let index = 0; index < 3; index += 1) await restarted.tick();
      expect(h.agent.commands).toContain('cancel');
    });
    it('Authoring create 失效后收束 attempt、终结 job 并关闭持有租约的 session', async () => {
      const h = harness();
      const jobId = startAuthoring(h);
      await untilOutbox(h.coordinator, 'authoring_agent_task.create');
      db.prepare(
        "UPDATE integration_outbox SET status = 'dispatching' WHERE command_type = 'authoring_agent_task.create'"
      ).run();
      revoke(jobId);
      const restarted = new SemanticCoordinatorService(h.options);
      restarted.initialize();
      await restarted.tick();
      expect(h.agent.createdRequest).toBeUndefined();
      expect(db.prepare('SELECT state FROM authoring_tasks WHERE job_id = ?').get(jobId)).toEqual({
        state: 'blocked',
      });
      expect(
        db.prepare('SELECT lifecycle, result_json FROM authoring_jobs WHERE id = ?').get(jobId)
      ).toEqual({
        lifecycle: 'failed',
        result_json: expect.stringContaining('side_effect_approval_required'),
      });
      expect(
        db.prepare('SELECT status, error_json FROM authoring_attempts WHERE job_id = ?').get(jobId)
      ).toEqual({
        status: 'interrupted',
        error_json: expect.stringContaining('side_effect_approval_required'),
      });
      await restarted.tick();
      expect(h.browser.closed).toBe(true);
      expect(h.browser.closedWithLease).toBe(true);
      expect((await h.browser.getSession()).activeLeases).toEqual([]);
      expect(
        h.secrets.has('coordinator-secret://browser-lease/10000000-0000-4000-8000-000000000001')
      ).toBe(false);
    });
    it('Authoring resume 重放校验原候选授权，失效时保留 paused 状态并允许 cancel 清理', async () => {
      const h = harness();
      const jobId = startAuthoring(h);
      await untilOutbox(h.coordinator, 'authoring_agent_task.create');
      const original = h.agent.createTask.bind(h.agent);
      vi.spyOn(h.agent, 'createTask').mockImplementationOnce(async (...args) => {
        const task = await original(...args);
        task.status = 'paused';
        task.completedAt = undefined;
        return task;
      });
      await h.coordinator.tick();
      const task = db.prepare('SELECT id FROM authoring_tasks WHERE job_id = ?').get(jobId) as {
        id: string;
      };
      evidence.enqueueOutbox({
        id: 'authoring-old-resume',
        context: { type: 'authoring', id: jobId },
        authoringTaskId: task.id,
        targetService: 'ai_chat_service',
        commandType: 'agent_task.command',
        endpointOrTool: '/api/v1/agent-tasks/:taskId/commands',
        payloadRedacted: { taskId: 'agent-task-1', command: 'resume', expectedStateVersion: 2 },
      });
      db.prepare(
        "UPDATE integration_outbox SET status = 'dispatching' WHERE id = 'authoring-old-resume'"
      ).run();
      revoke(jobId);
      const restarted = new SemanticCoordinatorService(h.options);
      restarted.initialize();
      for (let index = 0; index < 4; index += 1) await restarted.tick();
      expect(h.agent.commands).not.toContain('resume');
      expect(
        db.prepare("SELECT status FROM integration_outbox WHERE id = 'authoring-old-resume'").get()
      ).toEqual({ status: 'cancelled' });
      expect(db.prepare('SELECT lifecycle FROM authoring_jobs WHERE id = ?').get(jobId)).toEqual({
        lifecycle: 'paused',
      });
      expect(
        db
          .prepare(
            "SELECT payload_json FROM authoring_events WHERE job_id = ? AND type = 'authoring.state_changed' ORDER BY seq DESC LIMIT 1"
          )
          .get(jobId)
      ).toEqual({ payload_json: expect.stringContaining('"to":"paused"') });
      const paused = db
        .prepare('SELECT state_version FROM authoring_jobs WHERE id = ?')
        .get(jobId) as { state_version: number };
      new SemanticAuthoringService(
        workflows,
        assets,
        h.amendments,
        new BusinessVersionRepository(db)
      ).commandJob({
        commandId: 'authoring-cleanup-cancel',
        jobId,
        action: 'cancel',
        expectedStateVersion: paused.state_version,
        createdBy: 'operator',
      });
      for (let index = 0; index < 10; index += 1) await restarted.tick();
      expect(h.agent.commands).toContain('cancel');
      expect(h.browser.closed).toBe(true);
    });
    it('Agent create 前撤销授权，收束已开始的 attempt 与租约，重新审批可重新调度', async () => {
      const h = harness();
      const runId = startRun(h.fixture);
      await untilOutbox(h.coordinator, 'agent_task.create');
      revoke(runId);
      await h.coordinator.tick();
      expect(h.agent.createdRequest).toBeUndefined();
      expect(db.prepare('SELECT state FROM run_todos WHERE run_id = ?').get(runId)).toEqual({
        state: 'interrupted',
      });
      expect(db.prepare('SELECT state FROM page_tasks WHERE run_id = ?').get(runId)).toEqual({
        state: 'interrupted',
      });
      await h.coordinator.tick();
      expect((await h.browser.getSession()).activeLeases).toEqual([]);
      expect(h.browser.revoked).toBe(true);
      const decision = db
        .prepare(
          "SELECT id FROM decision_requests WHERE context_id = ? AND status = 'open' AND category = 'side_effect_approval'"
        )
        .get(runId) as { id: string };
      runs.answerDecision({
        runId,
        decisionId: decision.id,
        answerKey: 'approve',
        reason: '重新批准原精确计划',
        answeredBy: 'operator',
      });
      const state = db.prepare('SELECT state_version FROM test_runs WHERE id = ?').get(runId) as {
        state_version: number;
      };
      runs.command({
        runId,
        commandId: 'restart-approved',
        action: 'start',
        expectedStateVersion: state.state_version,
        createdBy: 'operator',
      });
      const todo = db.prepare('SELECT id FROM run_todos WHERE run_id = ?').get(runId) as {
        id: string;
      };
      runs.resumeInterruptedTodo(runId, todo.id);
      await untilOutbox(h.coordinator, 'agent_task.create');
      await h.coordinator.tick();
      expect(h.agent.createdRequest?.sideEffectAuthorization?.grant?.status).toBe('active');
    });
  });

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

    const agent = new FakeAgentTaskClient(undefined, {
      toolCalls: [
        {
          toolCallId: 'run-call-1',
          toolName: 'browser-control.operation_execute',
          status: 'succeeded',
          stepId: 'read-account',
          operationId: 'run-operation-1',
          operation: 'page_state',
        },
      ],
    });
    const browser = new FakeBrowserClient();
    browser.artifact = {
      id: 'artifact-1',
      kind: 'screenshot',
      sha256: HASH_A,
      mimeType: 'image/png',
      bytes: Buffer.from('image'),
    };
    const projectedActivities: AgentStreamEventV1[] = [];
    const activity: Pick<AgentActivityRepository, 'cursor' | 'append'> = {
      cursor: () => 0,
      append: (_context, _taskId, event) => {
        projectedActivities.push(event);
        return event;
      },
    };
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: agent,
      browser,
      activity: activity as AgentActivityRepository,
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
    ).toEqual({ count: 5 });
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS count FROM evidence_manifests WHERE run_id = ? AND status = 'sealed'"
        )
        .get(created.id)
    ).toEqual({ count: 1 });
    expect(browser.closed).toBe(true);
    expect(browser.closedWithLease).toBe(true);
    expect(agent.createdRequest?.browserBinding.browserLeaseToken).toBe('opaque-lease-token');
    const persistedAgentPayload = db
      .prepare(
        "SELECT payload_json_redacted FROM integration_outbox WHERE command_type = 'agent_task.create'"
      )
      .get() as { payload_json_redacted: string };
    expect(persistedAgentPayload.payload_json_redacted).not.toContain('opaque-lease-token');
    expect(
      db
        .prepare('SELECT sensitivity, redaction_status FROM artifact_objects WHERE id IS NOT NULL')
        .get()
    ).toEqual({ sensitivity: 'restricted', redaction_status: 'pending' });
    expect(projectedActivities).toEqual([
      expect.objectContaining({
        section: expect.objectContaining({ type: 'activity', kind: 'agent' }),
      }),
    ]);
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
    expect(browser.closedWithLease).toBe(true);
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

  it('将 PRD bootstrap 输出的新模块、脚本和场景作为不可见候选并在验证后原子激活', async () => {
    const fixture = createFixture(db, assets);
    const versions = new BusinessVersionRepository(db);
    const amendments = new AuthoringAmendmentRepository(db, assets);
    const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
    const moduleId = '20000000-0000-4000-8000-000000000001';
    const scriptId = '20000000-0000-4000-8000-000000000002';
    const scenarioId = '20000000-0000-4000-8000-000000000003';
    const pageId = '20000000-0000-4000-8000-000000000004';
    const job = authoring.createJob({
      businessVersionId: fixture.versionId,
      mode: 'bootstrap',
      idempotencyKey: 'bootstrap-product-navigation',
      currentUrl: 'https://test.example/account',
      reason: '根据 PRD 增加产品导航覆盖',
      createdBy: 'operator',
    });
    const scriptPayload = functionalScriptFixture({
      scriptKey: 'navigation.inspect',
      name: '检查产品导航',
      moduleId,
      pageId,
    });
    const agent = new FakeAgentTaskClient({
      status: 'candidate_ready',
      summary: '已从 PRD 拆分产品导航模块、脚本和场景',
      category: 'scenario_add',
      proposalsJson: JSON.stringify([
        {
          operation: 'create',
          assetType: 'page_definition',
          assetId: pageId,
          assetKey: 'navigation',
          candidatePayload: {
            schema: 'nebula.ai-e2e.page-definition/1.0',
            name: '产品导航页',
            routeMode: 'path',
            routeTemplate: '/navigation',
            identityQuery: {},
            runtimeParams: {},
            ignoredQueryKeys: [],
            authRequirement: { kind: 'anonymous' },
            recognition: [],
            allowedTransitionPageIds: [],
          },
          category: 'requirement',
          reason: 'PRD 识别出独立产品导航页面',
          targetUrl: 'https://test.example/navigation',
          targetPageDefinitionId: pageId,
        },
        {
          operation: 'create',
          assetType: 'functional_module',
          assetId: moduleId,
          assetKey: 'navigation',
          businessModuleId: fixture.businessModuleId,
          primaryPageDefinitionId: pageId,
          candidatePayload: {
            schema: 'nebula.ai-e2e.functional-module/1.0',
            name: '产品导航',
            sortOrder: 1,
            primaryPageDefinitionId: pageId,
          },
          category: 'module_call',
          reason: 'PRD 要求覆盖产品导航',
          targetUrl: 'https://test.example/navigation',
          targetPageDefinitionId: pageId,
        },
        {
          operation: 'create',
          assetType: 'functional_script',
          assetId: scriptId,
          assetKey: 'navigation.inspect',
          name: '检查产品导航',
          functionalModuleId: moduleId,
          candidatePayload: scriptPayload,
          category: 'script',
          reason: '生成可执行导航检查',
          targetUrl: 'https://test.example/navigation',
          targetPageDefinitionId: pageId,
        },
        {
          operation: 'create',
          assetType: 'test_scenario',
          assetId: scenarioId,
          assetKey: 'navigation-flow',
          name: '产品导航流程',
          candidatePayload: {
            schema: 'nebula.ai-e2e.scenario/1.0',
            scenarioKey: 'navigation-flow',
            name: '产品导航流程',
            purpose: '验证产品导航可用',
            prdSourceRefs: [],
            actors: [],
            initialAuth: { kind: 'anonymous' },
            inputs: [],
            finalAcceptance: [],
            calls: [{ callKey: 'inspect', functionalScriptId: scriptId }],
            edges: [],
            exports: [],
          },
          category: 'scenario_add',
          reason: '形成 PRD 验收场景',
          targetUrl: 'https://test.example/navigation',
          targetPageDefinitionId: pageId,
          targetFunctionalModuleId: moduleId,
        },
      ]),
      validationPlanJson: JSON.stringify({ strategy: 'static_then_browser_verification' }),
      potentialSideEffectsJson: '{}',
    });
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

    let amendment = amendments.listAmendments(job.id)[0]!;
    expect(amendment.state).toBe('waiting_decision');
    expect(versions.getAssetGraph(fixture.versionId).functionalModules).toHaveLength(1);
    expect(
      db
        .prepare('SELECT COUNT(*) AS count FROM semantic_functional_modules WHERE id = ?')
        .get(moduleId)
    ).toEqual({ count: 1 });
    for (const decisionId of amendment.decisionIds) {
      amendment = authoring.answerDecision({
        amendmentId: amendment.id,
        decisionId,
        answer: 'approve',
        reason: '批准 PRD bootstrap 范围',
        answeredBy: 'operator',
      });
    }
    expect(authoring.command(amendment.id, { action: 'queue_at_safe_boundary' }).state).toBe(
      'verifying'
    );
    for (let index = 0; index < 18; index += 1) await coordinator.tick();

    const graph = versions.getAssetGraph(fixture.versionId);
    expect(amendments.getAmendment(amendment.id)?.state).toBe('activated');
    expect(graph.functionalModules.some((entry) => entry.id === moduleId)).toBe(true);
    expect(graph.pages.some((entry) => entry.id === pageId)).toBe(true);
    expect(graph.functionalScripts.some((entry) => entry.id === scriptId)).toBe(true);
    expect(graph.scenarios.some((entry) => entry.id === scenarioId)).toBe(true);
    expect(
      (
        agent.createdRequest?.toolPolicy.constraints?.['browser-control.operation_execute'] as {
          steps: unknown[];
        }
      ).steps
    ).toHaveLength(2);
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

  it.each(['run', 'authoring'] as const)(
    '%s 对账保留游标、输出哈希和任务关联，幂等传播暂停、恢复与取消',
    async (contextType) => {
      const fixture = createFixture(db, assets);
      const versions = new BusinessVersionRepository(db);
      const amendments = new AuthoringAmendmentRepository(db, assets);
      const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
      let contextId: string;
      if (contextType === 'run') {
        const run = runs.createFormalRun({
          projectId: 'project-1',
          businessVersionId: fixture.versionId,
          clientRunId: 'reconcile-run',
          scenarioRevisionId: fixture.scenarioRevisionId,
          deploymentRevisionId: fixture.deploymentRevisionId,
          inputs: {},
        });
        contextId = run.id;
        runs.command({
          commandId: 'start-reconcile-run',
          runId: contextId,
          action: 'start',
          expectedStateVersion: 2,
          createdBy: 'operator',
        });
      } else {
        contextId = authoring.createJob({
          businessVersionId: fixture.versionId,
          mode: 'repair',
          idempotencyKey: 'reconcile-authoring',
          targetType: 'functional_module',
          targetId: fixture.moduleId,
          currentUrl: 'https://test.example/account',
          reason: '验证任务对账',
          createdBy: 'operator',
        }).id;
      }
      const output = { summary: '任务中间输出' };
      const override: Partial<AgentTaskView> = {
        status: 'running',
        output,
        completedAt: undefined,
      };
      const agent = new FakeAgentTaskClient(undefined, override, override);
      const listTaskEvents = vi.fn(async (taskId: string, afterSeq = 0) => {
        const task = await agent.getTask(taskId);
        const seq = task.stateVersion + 4;
        if (seq <= afterSeq) return [];
        return [
          {
            id: `event-${seq}`,
            taskId,
            seq,
            type: 'task.state_changed',
            entityType: 'task',
            entityId: taskId,
            stateVersion: task.stateVersion,
            payload: { status: task.status },
            occurredAt: task.updatedAt,
            createdAt: task.updatedAt,
          } satisfies AgentTaskEventRecord,
        ];
      });
      const activity: Pick<AgentActivityRepository, 'cursor' | 'append'> = {
        cursor: vi.fn(() => 0),
        append: vi.fn((_context, _taskId, event) => event),
      };
      const listTaskActivity = vi.spyOn(agent, 'listTaskActivity');
      const commandTask = vi.spyOn(agent, 'commandTask');
      const coordinator = new SemanticCoordinatorService({
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        agentTasks: Object.assign(agent, { listTaskEvents }),
        browser: new FakeBrowserClient(),
        activity: activity as AgentActivityRepository,
        secretStore: new MemoryCoordinatorSecretStore(),
        authoringCandidates: new SemanticAuthoringCandidateService(
          new SemanticQueryRepository(db, versions),
          assets,
          amendments
        ),
      });
      for (let index = 0; index < 8; index += 1) await coordinator.tick();
      const context = { type: contextType, id: contextId };
      const link = db
        .prepare("SELECT * FROM external_task_links WHERE kind = 'agent_task'")
        .get() as Record<string, unknown>;
      const association =
        contextType === 'run'
          ? { pageTaskId: String(link.page_task_id) }
          : { authoringTaskId: String(link.authoring_task_id) };
      expect(link).toMatchObject({
        context_type: contextType,
        context_id: contextId,
        external_state: 'running',
        last_external_seq: 6,
        result_sha256: hashValue(output),
        terminal_at: null,
      });
      expect(link[contextType === 'run' ? 'page_task_id' : 'authoring_task_id']).toBeTruthy();
      expect(link[contextType === 'run' ? 'authoring_task_id' : 'page_task_id']).toBeNull();
      expect(listTaskEvents).toHaveBeenCalledWith('agent-task-1', 3, 500);
      expect(listTaskEvents).toHaveBeenCalledWith('agent-task-1', 6, 500);
      expect(listTaskActivity).toHaveBeenCalledWith('agent-task-1', 0, 500);
      expect(activity.append).toHaveBeenCalledWith(
        context,
        'agent-task-1',
        expect.any(Object),
        contextType === 'run' ? { ...association, todoId: expect.any(String) } : association
      );
      const task = await agent.getTask('agent-task-1');
      for (const [index, action] of ['pause', 'resume', 'cancel'].entries()) {
        if (action === 'resume') task.eventSeq = 8;
        const lifecycleTable = contextType === 'run' ? 'test_runs' : 'authoring_jobs';
        const current = db
          .prepare(`SELECT state_version FROM ${lifecycleTable} WHERE id = ?`)
          .get(contextId) as { state_version: number };
        const command = {
          commandId: `reconcile-${action}`,
          action: action as 'pause' | 'resume' | 'cancel',
          expectedStateVersion: current.state_version,
          createdBy: 'operator',
        };
        if (contextType === 'run') runs.command({ ...command, runId: contextId });
        else authoring.commandJob({ ...command, jobId: contextId });
        expect(await coordinator.tick()).toEqual({
          action: `${contextType === 'run' ? 'agent_task' : 'authoring_agent_task'}.${action}_queued`,
        });
        const stateVersion = index + 2;
        const id = `agent-task-command:agent-task-1:${action}:v${stateVersion}`;
        const outbox = db
          .prepare('SELECT * FROM integration_outbox WHERE id = ?')
          .get(id) as Record<string, unknown>;
        expect(outbox).toMatchObject({
          context_type: contextType,
          context_id: contextId,
          page_task_id: link.page_task_id,
          authoring_task_id: link.authoring_task_id,
          command_type: 'agent_task.command',
          endpoint_or_tool: '/api/v1/agent-tasks/:taskId/commands',
        });
        expect(evidence.getOutboxPayload(id)).toEqual({
          taskId: 'agent-task-1',
          command: action,
          expectedStateVersion: stateVersion,
        });
        if (action === 'resume') {
          expect(
            db
              .prepare('SELECT last_external_seq FROM external_task_links WHERE id = ?')
              .get(link.id)
          ).toEqual({ last_external_seq: 8 });
        }
        expect(await coordinator.tick()).toEqual({ action: 'outbox:agent_task.command' });
        expect(
          db
            .prepare('SELECT COUNT(*) AS count, status FROM integration_outbox WHERE id = ?')
            .get(id)
        ).toEqual({ count: 1, status: 'confirmed' });
        expect(commandTask).toHaveBeenLastCalledWith(
          'agent-task-1',
          expect.objectContaining({
            commandId: id,
            type: action,
            expectedStateVersion: stateVersion,
          })
        );
      }
      await coordinator.tick();
      expect(
        db
          .prepare(
            'SELECT external_state, last_external_seq, result_sha256, terminal_at FROM external_task_links WHERE id = ?'
          )
          .get(link.id)
      ).toMatchObject({
        external_state: 'cancelled',
        last_external_seq: 10,
        result_sha256: hashValue(output),
        terminal_at: expect.any(String),
      });
      expect(agent.commands).toEqual(['pause', 'resume', 'cancel']);
    }
  );

  it('在安全边界暂停运行中的 Authoring Agent，并在取消后收敛作业和会话', async () => {
    const fixture = createFixture(db, assets);
    const versions = new BusinessVersionRepository(db);
    const amendments = new AuthoringAmendmentRepository(db, assets);
    const authoring = new SemanticAuthoringService(workflows, assets, amendments, versions);
    const job = authoring.createJob({
      businessVersionId: fixture.versionId,
      mode: 'repair',
      idempotencyKey: 'controlled-authoring-job',
      targetType: 'functional_module',
      targetId: fixture.moduleId,
      currentUrl: 'https://test.example/account',
      reason: '验证作业控制',
      createdBy: 'operator',
    });
    const agent = new FakeAgentTaskClient(undefined, undefined, {
      status: 'running',
      output: undefined,
      completedAt: undefined,
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

    for (let index = 0; index < 8; index += 1) await coordinator.tick();
    const running = db
      .prepare('SELECT state_version FROM authoring_jobs WHERE id = ?')
      .get(job.id) as { state_version: number };
    authoring.commandJob({
      commandId: 'pause-controlled-authoring',
      jobId: job.id,
      action: 'pause',
      expectedStateVersion: running.state_version,
      createdBy: 'operator',
    });
    const pauseActions: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      pauseActions.push((await coordinator.tick()).action);
    }
    expect(pauseActions).toContain('authoring_agent_task.pause_queued');
    expect(agent.commands).toContain('pause');
    expect(browser.closed).toBe(false);

    const paused = db
      .prepare('SELECT lifecycle, state_version FROM authoring_jobs WHERE id = ?')
      .get(job.id) as { lifecycle: string; state_version: number };
    expect(paused.lifecycle).toBe('paused');
    authoring.commandJob({
      commandId: 'cancel-controlled-authoring',
      jobId: job.id,
      action: 'cancel',
      expectedStateVersion: paused.state_version,
      createdBy: 'operator',
    });
    for (let index = 0; index < 16; index += 1) await coordinator.tick();

    expect(agent.commands).toContain('cancel');
    expect(
      db.prepare('SELECT lifecycle, outcome FROM authoring_jobs WHERE id = ?').get(job.id)
    ).toEqual({ lifecycle: 'cancelled', outcome: 'cancelled' });
    expect(
      db.prepare('SELECT status FROM authoring_attempts WHERE task_id = ?').get(job.taskId)
    ).toEqual({
      status: 'cancelled',
    });
    expect(browser.closedWithLease).toBe(true);
    expect(browser.closed).toBe(true);
  });

  it.each([
    [
      'interrupted',
      { status: 'interrupted', error: { code: 'process_restart', message: 'restarted' } },
      'recoverable_interruption',
      'process_restart',
    ],
    [
      'interrupted-defaults',
      { status: 'interrupted' },
      'recoverable_interruption',
      'agent_interrupted',
    ],
    ['cancelled', { status: 'cancelled' }, 'cancelled', 'run_cancelled'],
    [
      'blocked',
      { status: 'blocked', error: { code: 'login_required', message: 'blocked' } },
      'precondition_blocked',
      'login_required',
    ],
    ['blocked-defaults', { status: 'blocked' }, 'precondition_blocked', 'agent_blocked'],
    [
      'failed',
      { status: 'failed', error: { code: 'tool_failed', message: 'failed' } },
      'execution_failed',
      'tool_failed',
    ],
    ['failed-defaults', { status: 'failed' }, 'execution_failed', 'agent_failed'],
    [
      'unknown',
      {
        status: 'failed',
        toolCalls: [
          {
            toolCallId: 'unknown-call',
            toolName: 'browser-control.operation_execute',
            status: 'outcome_unknown',
            stepId: 'write-step',
            operationId: 'unknown-operation',
            operation: 'click',
          },
        ],
      },
      'outcome_unknown',
      'browser_outcome_unknown',
    ],
    [
      'oversized',
      {
        status: 'completed',
        output: { result: 'succeeded', reasonClass: 'ok', summary: 'x'.repeat(4_001) },
      },
      'execution_failed',
      'invalid_agent_output',
    ],
    [
      'invalid-result',
      {
        status: 'completed',
        output: {
          result: 'not-allowed',
          reasonClass: '',
          summary: '',
          checkpointJson: '{invalid',
          actualPageJson: '[]',
        },
      },
      'execution_failed',
      'invalid_agent_output',
    ],
    [
      'decision',
      {
        status: 'completed',
        output: {
          result: 'decision_required',
          reasonClass: 'operator_choice',
          summary: 'choose',
          checkpointJson: '{"step":1}',
          actualPageJson: '{"url":"/account"}',
          confirmedOutputsJson: '{"confirmed":true}',
          partialOutputsJson: '{"partial":true}',
          sideEffectsJson: '{"writes":0}',
          downstreamImpactJson: '{"blocked":true}',
        },
      },
      'decision_required',
      'operator_choice',
    ],
  ] as const)(
    'maps a terminal %s Agent task without weakening the run result',
    async (_name, override, expectedResult, expectedReason) => {
      const fixture = createFixture(db, assets);
      const created = runs.createFormalRun({
        projectId: 'project-1',
        businessVersionId: fixture.versionId,
        clientRunId: `terminal-${_name}`,
        scenarioRevisionId: fixture.scenarioRevisionId,
        deploymentRevisionId: fixture.deploymentRevisionId,
        inputs: {},
      });
      runs.command({
        commandId: `start-${_name}`,
        runId: created.id,
        action: 'start',
        expectedStateVersion: 2,
        createdBy: 'operator',
      });
      const coordinator = new SemanticCoordinatorService({
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        agentTasks: new FakeAgentTaskClient(undefined, override),
        browser: new FakeBrowserClient(),
        secretStore: new MemoryCoordinatorSecretStore(),
        artifactStore: { persist: async () => ({ storageKey: 'unused', sizeBytes: 0 }) } as never,
      });

      for (let index = 0; index < 14; index += 1) await coordinator.tick();

      expect(
        db
          .prepare(
            'SELECT result, reason_class FROM execution_attempts WHERE run_id = ? ORDER BY attempt_no DESC LIMIT 1'
          )
          .get(created.id)
      ).toEqual({ result: expectedResult, reason_class: expectedReason });
    }
  );

  it.each([
    [
      'agent envelope',
      { schema: 'wrong', service: 'ai-chat-service', protocols: {} },
      undefined,
      'capability_mismatch',
    ],
    [
      'agent protocol',
      {
        schema: 'nebula.service-capabilities/1.0',
        service: 'ai-chat-service',
        protocols: { 'nebula.ai.agent-task': { major: 2 } },
      },
      undefined,
      'capability_mismatch',
    ],
    [
      'browser limits',
      undefined,
      { limits: { maxActiveBrowserSessions: 2, maxBrowserContextsPerSession: 1 } },
      'capability_mismatch',
    ],
    ['browser envelope', undefined, { schema: 'wrong' }, 'capability_mismatch'],
    [
      'browser protocol',
      undefined,
      { protocols: { browserExecution: { major: 2 } } },
      'capability_mismatch',
    ],
    ['agent loopback', undefined, undefined, 'permission_denied'],
    ['browser loopback', undefined, undefined, 'permission_denied'],
    ['side-effect authorization', undefined, undefined, 'capability_mismatch'],
  ] as const)(
    'fails closed on incompatible %s capabilities',
    async (kind, agentOverride, browserOverride, code) => {
      const agent = new FakeAgentTaskClient();
      const browser = new FakeBrowserClient();
      if (agentOverride) agent.capabilities = agentOverride;
      if (browserOverride) Object.assign(browser.capabilities, browserOverride);
      if (kind === 'agent loopback') {
        agent.capabilities = {
          ...agent.capabilities,
          features: { ...agent.capabilities.features, localControlPlane: false },
        };
      }
      if (kind === 'browser loopback') {
        browser.capabilities = {
          ...browser.capabilities,
          features: { localControlPlane: false },
        };
      }
      if (kind === 'side-effect authorization') {
        agent.capabilities = {
          ...agent.capabilities,
          features: {
            ...agent.capabilities.features,
            sideEffectAuthorization: 'none',
          },
        };
      }
      const coordinator = new SemanticCoordinatorService({
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        agentTasks: agent,
        browser,
        secretStore: new MemoryCoordinatorSecretStore(),
      });

      await expect(coordinator.tick()).rejects.toMatchObject({ code });
    }
  );

  it('settles an unsupported outbox command as terminal and pauses the owning run', async () => {
    const fixture = createFixture(db, assets);
    const created = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'unsupported-outbox-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    runs.command({
      commandId: 'start-unsupported-outbox-run',
      runId: created.id,
      action: 'start',
      expectedStateVersion: 2,
      createdBy: 'operator',
    });
    evidence.enqueueOutbox({
      id: 'unsupported-outbox',
      context: { type: 'run', id: created.id },
      targetService: 'proxy_adapter',
      commandType: 'unsupported.command',
      endpointOrTool: '/unsupported',
      payloadRedacted: {},
    });
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: new FakeBrowserClient(),
      secretStore: new MemoryCoordinatorSecretStore(),
    });

    await expect(coordinator.tick()).resolves.toEqual({ action: 'outbox:unsupported.command' });
    expect(
      db
        .prepare('SELECT status, last_error_json FROM integration_outbox WHERE id = ?')
        .get('unsupported-outbox')
    ).toMatchObject({ status: 'terminal_failed' });
    expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(created.id)).toEqual({
      lifecycle: 'paused',
    });
  });

  it('schedules retryable integration failures and terminally fails an acquiring browser job', async () => {
    const fixture = createFixture(db, assets);
    const retryRun = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'retryable-outbox-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    evidence.enqueueOutbox({
      id: 'retryable-session-create',
      context: { type: 'run', id: retryRun.id },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.create',
      endpointOrTool: '/api/v1/browser-execution/sessions',
      payloadRedacted: { browserJobId: retryRun.browserJobId },
    });
    const retryBrowser = new FakeBrowserClient();
    retryBrowser.createSessionError = new IntegrationClientError(
      'proxy-adapter',
      'browser_unavailable',
      'retry later',
      true,
      503,
      { nextAttemptAt: '2099-01-01T00:01:00.000Z' }
    );
    const retryCoordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: retryBrowser,
      secretStore: new MemoryCoordinatorSecretStore(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    await retryCoordinator.tick();
    expect(
      db
        .prepare('SELECT status, next_attempt_at FROM integration_outbox WHERE id = ?')
        .get('retryable-session-create')
    ).toEqual({
      status: 'retryable_failed',
      next_attempt_at: '2099-01-01T00:01:00.000Z',
    });
    const abandoned = workflows.claimNextBrowserJob();
    if (abandoned) workflows.transitionBrowserJob(String(abandoned.id), 'failed');

    const failedRun = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'terminal-outbox-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    workflows.claimNextBrowserJob();
    evidence.enqueueOutbox({
      id: 'terminal-session-create',
      context: { type: 'run', id: failedRun.id },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.create',
      endpointOrTool: '/api/v1/browser-execution/sessions',
      payloadRedacted: { browserJobId: failedRun.browserJobId },
    });
    const terminalBrowser = new FakeBrowserClient();
    terminalBrowser.createSessionError = new IntegrationClientError(
      'proxy-adapter',
      'permission_denied',
      'fatal',
      false,
      403
    );
    const terminalCoordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: terminalBrowser,
      secretStore: new MemoryCoordinatorSecretStore(),
    });

    await terminalCoordinator.tick();
    expect(
      db
        .prepare('SELECT status FROM integration_outbox WHERE id = ?')
        .get('terminal-session-create')
    ).toEqual({ status: 'terminal_failed' });
  });

  it('deduplicates concurrent ticks and caches a compatible capability snapshot', async () => {
    const agent = new FakeAgentTaskClient();
    let releaseCapabilities!: () => void;
    agent.capabilityGate = new Promise<void>((resolve) => {
      releaseCapabilities = resolve;
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
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    const first = coordinator.tick();
    await expect(coordinator.tick()).resolves.toEqual({ action: 'already_running' });
    releaseCapabilities();
    await expect(first).resolves.toEqual({ action: 'idle' });
    await expect(coordinator.tick()).resolves.toEqual({ action: 'idle' });
    expect(agent.capabilityCalls).toBe(1);
    expect(browser.capabilityCalls).toBe(1);
  });

  it('在持久化 outbox 载荷损坏时终止派发并暂停所属运行', async () => {
    const fixture = createFixture(db, assets);
    const created = runs.createFormalRun({
      projectId: 'project-1',
      businessVersionId: fixture.versionId,
      clientRunId: 'corrupt-outbox-run',
      scenarioRevisionId: fixture.scenarioRevisionId,
      deploymentRevisionId: fixture.deploymentRevisionId,
      inputs: {},
    });
    evidence.enqueueOutbox({
      id: 'corrupt-outbox',
      context: { type: 'run', id: created.id },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.close',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId',
      payloadRedacted: { browserSessionId: SESSION_ID },
    });
    db.prepare('UPDATE integration_outbox SET payload_json_redacted = ? WHERE id = ?').run(
      '{',
      'corrupt-outbox'
    );
    const coordinator = new SemanticCoordinatorService({
      repository: new SemanticCoordinatorRepository(db),
      workflows,
      evidence,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: new FakeBrowserClient(),
      secretStore: new MemoryCoordinatorSecretStore(),
    });

    await expect(coordinator.tick()).resolves.toEqual({
      action: 'outbox:browser_session.close',
    });
    expect(
      db
        .prepare('SELECT status, last_error_json FROM integration_outbox WHERE id = ?')
        .get('corrupt-outbox')
    ).toMatchObject({ status: 'terminal_failed' });
    expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(created.id)).toEqual({
      lifecycle: 'paused',
    });
  });

  it.each([null, [42], ['unsupported_operation']])(
    '拒绝损坏的 outbox 浏览器操作集合 %j，且不签发租约',
    async (operations) => {
      const fixture = createFixture(db, assets);
      const created = runs.createFormalRun({
        projectId: 'project-1',
        businessVersionId: fixture.versionId,
        clientRunId: 'corrupt-lease-outbox-run',
        scenarioRevisionId: fixture.scenarioRevisionId,
        deploymentRevisionId: fixture.deploymentRevisionId,
        inputs: {},
      });
      evidence.enqueueOutbox({
        id: 'corrupt-lease-outbox',
        context: { type: 'run', id: created.id },
        targetService: 'proxy_adapter',
        commandType: 'browser_lease.create',
        endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId/leases',
        payloadRedacted: {
          runId: created.id,
          todoId: 'todo-1',
          browserSessionId: SESSION_ID,
          operations,
        },
      });
      const browser = new FakeBrowserClient();
      const createLease = vi.spyOn(browser, 'createLease');
      const coordinator = new SemanticCoordinatorService({
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        agentTasks: new FakeAgentTaskClient(),
        browser,
        secretStore: new MemoryCoordinatorSecretStore(),
      });
      await expect(coordinator.tick()).resolves.toEqual({ action: 'outbox:browser_lease.create' });
      expect(createLease).not.toHaveBeenCalled();
      expect(
        db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get('corrupt-lease-outbox')
      ).toEqual({ status: 'terminal_failed' });
      expect(db.prepare('SELECT lifecycle FROM test_runs WHERE id = ?').get(created.id)).toEqual({
        lifecycle: 'paused',
      });
    }
  );

  describe('持久关闭意图的清理租约恢复', () => {
    function closingHarness() {
      const fixture = createFixture(db, assets);
      const run = runs.createFormalRun({
        projectId: 'project-1',
        businessVersionId: fixture.versionId,
        clientRunId: 'cleanup-run',
        scenarioRevisionId: fixture.scenarioRevisionId,
        deploymentRevisionId: fixture.deploymentRevisionId,
        inputs: {},
      });
      if (!run.browserJobId) throw new Error('Run browser job missing');
      workflows.transitionBrowserJob(run.browserJobId, 'acquiring');
      workflows.transitionBrowserJob(run.browserJobId, 'active', { browserSessionId: SESSION_ID });
      const browser = new FakeBrowserClient();
      const secrets = new MemoryCoordinatorSecretStore();
      const options = {
        repository: new SemanticCoordinatorRepository(db),
        workflows,
        evidence,
        runs,
        browser,
        agentTasks: new FakeAgentTaskClient(),
        secretStore: secrets,
      };
      function enqueue(credentials?: { leaseId: string; secretRef: string }) {
        evidence.enqueueOutbox({
          id: 'cleanup-close',
          context: { type: 'run', id: run.id },
          targetService: 'proxy_adapter',
          commandType: 'browser_session.close',
          endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId',
          payloadRedacted: {
            browserSessionId: SESSION_ID,
            ...(credentials ? { browserLeaseId: credentials.leaseId } : {}),
          },
          ...(credentials ? { secretBindingRef: credentials.secretRef } : {}),
        });
      }
      function retryNow() {
        db.prepare(
          "UPDATE integration_outbox SET next_attempt_at = NULL WHERE status = 'retryable_failed'"
        ).run();
      }
      return {
        options,
        browser,
        secrets,
        enqueue,
        retryNow,
        coordinator: new SemanticCoordinatorService(options),
      };
    }

    it('无本意图token的活动控制权等到expiresAt，超过8次仍保留关闭意图', async () => {
      const h = closingHarness();
      const issued = await h.browser.createLease(SESSION_ID, 'foreign-control', {
        mode: 'control',
        ttlSeconds: 300,
      });
      h.secrets.put('unrelated-secret', 'unrelated-value');
      h.enqueue();
      db.prepare('UPDATE integration_outbox SET attempt_count = 9 WHERE id = ?').run(
        'cleanup-close'
      );
      const createLease = vi.spyOn(h.browser, 'createLease');
      await h.coordinator.tick();
      expect(
        db
          .prepare(
            'SELECT status, next_attempt_at, last_error_json FROM integration_outbox WHERE id = ?'
          )
          .get('cleanup-close')
      ).toMatchObject({
        status: 'retryable_failed',
        next_attempt_at: new Date(Date.parse(issued.lease.expiresAt) + 1000).toISOString(),
        last_error_json: expect.stringContaining('lease_token_unavailable'),
      });
      expect(createLease).not.toHaveBeenCalled();
      expect(h.browser.closed).toBe(false);
      expect(h.secrets.get('unrelated-secret')).toBe('unrelated-value');
    });

    it.each(['cleanup', 'original', 'cleanup_404'] as const)(
      '远端关闭成功但确认丢失，重启清理%s凭据并释放FIFO',
      async (kind) => {
        const h = closingHarness();
        let secretRef: string | undefined;
        if (kind === 'original') {
          const issued = await h.browser.createLease(SESSION_ID, 'original', {
            mode: 'control',
            ttlSeconds: 300,
          });
          secretRef = `coordinator-secret://browser-lease/${issued.lease.id}`;
          h.secrets.put(secretRef, issued.token);
          h.enqueue({ leaseId: issued.lease.id, secretRef });
        } else h.enqueue();
        h.secrets.put('unrelated-secret', 'preserve');
        const originalClose = h.browser.closeSession.bind(h.browser);
        vi.spyOn(h.browser, 'closeSession').mockImplementationOnce(async (...args) => {
          await originalClose(...args);
          throw new IntegrationClientError(
            'proxy-adapter',
            'network_error',
            'confirmation lost',
            true
          );
        });
        const createLease = vi.spyOn(h.browser, 'createLease');
        await h.coordinator.tick();
        secretRef ??= String(
          (
            db
              .prepare("SELECT secret_ref FROM external_task_links WHERE kind = 'browser_lease'")
              .get() as { secret_ref: string }
          ).secret_ref
        );
        expect(h.secrets.get(secretRef)).toBeTruthy();
        h.retryNow();
        if (kind === 'cleanup_404') {
          vi.spyOn(h.browser, 'getSession').mockRejectedValueOnce(
            new IntegrationClientError(
              'proxy-adapter',
              'session_not_found',
              'Closed session no longer available',
              false,
              404
            )
          );
        }
        await new SemanticCoordinatorService(h.options).tick();
        expect(h.secrets.get(secretRef)).toBeUndefined();
        expect(h.secrets.get('unrelated-secret')).toBe('preserve');
        expect(h.options.repository.getActiveBrowserJob()).toBeNull();
        expect(createLease).toHaveBeenCalledTimes(kind === 'original' ? 0 : 1);
        expect(
          db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get('cleanup-close')
        ).toEqual({ status: 'confirmed' });
      }
    );

    it.each(['lost_token', 'retained_token'] as const)(
      '清理租约过期后以新恢复意图关闭（%s），不永远重放旧租约',
      async (tokenState) => {
        const h = closingHarness();
        h.enqueue();
        const createLease = vi.spyOn(h.browser, 'createLease');
        vi.spyOn(h.browser, 'closeSession').mockRejectedValueOnce(
          new IntegrationClientError('proxy-adapter', 'network_error', 'close unavailable', true)
        );
        await h.coordinator.tick();
        const firstIssue = createLease.mock.results[0];
        if (!firstIssue) throw new Error('Cleanup lease was not issued');
        const issued = await firstIssue.value;
        const secretRef = `coordinator-secret://browser-lease/${issued.lease.id}`;
        if (tokenState === 'lost_token') {
          h.secrets.delete(secretRef);
          h.retryNow();
          await new SemanticCoordinatorService(h.options).tick();
          expect(createLease).toHaveBeenCalledTimes(1);
          expect(
            db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get('cleanup-close')
          ).toEqual({ status: 'retryable_failed' });
        }
        await h.browser.revokeLease();
        h.retryNow();
        createLease.mockResolvedValueOnce({
          lease: { ...issued.lease, status: 'expired' },
          tokenIssued: false,
        } as never);
        const restarted = new SemanticCoordinatorService(h.options);
        await restarted.tick();
        expect(
          db.prepare('SELECT status FROM integration_outbox WHERE id = ?').get('cleanup-close')
        ).toEqual({ status: 'confirmed' });
        expect(h.options.repository.getActiveBrowserJob()).not.toBeNull();
        await restarted.tick();
        expect(h.browser.closed).toBe(true);
        expect(h.options.repository.getActiveBrowserJob()).toBeNull();
        expect(createLease.mock.calls[2]?.[1]).toBe('cleanup-close:recovery:1:cleanup');
        const recoveredIssue = createLease.mock.results[2];
        if (!recoveredIssue) throw new Error('Recovery lease missing');
        expect(
          h.secrets.get(
            `coordinator-secret://browser-lease/${(await recoveredIssue.value).lease.id}`
          )
        ).toBeUndefined();
        expect(h.secrets.get(secretRef)).toBeUndefined();
      }
    );

    it('interrupted session直接关闭，不申请清理lease', async () => {
      const h = closingHarness();
      h.enqueue();
      const session = await h.browser.getSession();
      vi.spyOn(h.browser, 'getSession').mockResolvedValue({ ...session, status: 'interrupted' });
      const createLease = vi.spyOn(h.browser, 'createLease');
      const close = vi
        .spyOn(h.browser, 'closeSession')
        .mockResolvedValue({ ...session, status: 'closed' });
      await h.coordinator.tick();
      expect(createLease).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledExactlyOnceWith(SESSION_ID, 'cleanup-close', undefined);
      expect(h.options.repository.getActiveBrowserJob()).toBeNull();
    });
  });

  it('在浏览器作业安全边界按运行与 Authoring 生命周期派发控制命令', async () => {
    let currentJob = {
      id: 'job-1',
      queueSeq: 1,
      contextType: 'run' as const,
      contextId: 'run-1',
      state: 'acquiring' as const,
    };
    let lifecycle = 'running';
    let settledCancellation = 0;
    const enqueued: unknown[] = [];
    const repository = {
      getVerificationAmendmentToSchedule: () => null,
      getActiveBrowserJob: () => currentJob,
      getBrowserSessionLink: () => null,
      getActivePageTask: () => null,
      getRunLifecycle: () => lifecycle,
      getReadyTodo: () => null,
      getAuthoringJobLifecycle: () => lifecycle,
      getAuthoringTask: () => null,
    } as unknown as SemanticCoordinatorRepository;
    const workflowPort = {
      claimNextBrowserJob: () => null,
      settleAuthoringCancellation: () => {
        settledCancellation += 1;
      },
    } as unknown as SemanticWorkflowRepository;
    const evidencePort = {
      hasPendingPolicyLeaseRevocation: () => false,
      recoverDispatchingOutbox: () => 0,
      claimNextOutbox: () => null,
      enqueueOutbox: (command: unknown) => enqueued.push(command),
    } as unknown as SemanticEvidenceRepository;
    const coordinator = new SemanticCoordinatorService({
      repository,
      workflows: workflowPort,
      evidence: evidencePort,
      runs,
      agentTasks: new FakeAgentTaskClient(),
      browser: new FakeBrowserClient(),
      secretStore: new MemoryCoordinatorSecretStore(),
    });

    await expect(coordinator.tick()).resolves.toEqual({ action: 'browser_session.queued' });

    currentJob = {
      ...currentJob,
      state: 'releasing',
    };
    await expect(coordinator.tick()).resolves.toEqual({ action: 'idle' });

    currentJob = {
      ...currentJob,
      state: 'active',
      browserSessionId: SESSION_ID,
    };
    lifecycle = 'completed';
    await expect(coordinator.tick()).resolves.toEqual({ action: 'browser_session.close_queued' });

    currentJob = {
      ...currentJob,
      contextType: 'authoring',
      contextId: 'authoring-1',
    };
    lifecycle = 'cancelling';
    await expect(coordinator.tick()).resolves.toEqual({ action: 'authoring.cancelled' });
    expect(settledCancellation).toBe(1);

    lifecycle = 'waiting_decision';
    await expect(coordinator.tick()).resolves.toEqual({ action: 'browser_session.close_queued' });

    lifecycle = 'paused';
    await expect(coordinator.tick()).resolves.toEqual({ action: 'authoring.paused' });
    expect(enqueued).toHaveLength(4);
  });

  it.each([
    ['cancelling', 'running', 'cancel'],
    ['paused', 'running', 'pause'],
    ['running', 'paused', 'resume'],
    ['running', 'running', null],
    ['cancelling', 'completed', null],
  ] as const)('maps run %s and Agent %s to %s', (runState, agentState, command) => {
    expect(desiredAgentCommand(runState, agentState)).toBe(command);
  });
});

class FakeAgentTaskClient implements AgentTaskClientPort {
  createdRequest?: CreateAgentTaskRequest;
  commands: Array<'pause' | 'resume' | 'interrupt' | 'cancel'> = [];
  capabilityCalls = 0;
  capabilityGate?: Promise<void>;
  capabilities: Record<string, unknown> = {
    schema: 'nebula.service-capabilities/1.0',
    service: 'ai-chat-service',
    protocols: { 'nebula.ai.agent-task': { major: 1, minor: 0 } },
    features: {
      localControlPlane: true,
      sideEffectAuthorization: 'preauthorized_steps_only',
    },
    limits: {},
  };
  private readonly tasks = new Map<string, AgentTaskView>();

  constructor(
    private readonly authoringOutput?: Record<string, unknown>,
    private readonly runTaskOverride?: Partial<AgentTaskView>,
    private readonly authoringTaskOverride?: Partial<AgentTaskView>
  ) {}

  async getCapabilities(): Promise<Record<string, unknown>> {
    this.capabilityCalls += 1;
    await this.capabilityGate;
    return this.capabilities;
  }

  async createTask(input: CreateAgentTaskRequest): Promise<AgentTaskView> {
    this.createdRequest = input;
    const taskId = `agent-task-${this.tasks.size + 1}`;
    const verifying = input.clientTaskId.startsWith('authoring-verification:');
    const { browserBinding, ...requestWithoutBinding } = input;
    let safeBinding: PersistedAgentTaskRequest['browserBinding'];
    if (browserBinding) {
      const { browserLeaseToken: _token, ...safe } = browserBinding;
      safeBinding = safe;
    }
    const task: AgentTaskView = {
      modelRole: 'decision',
      request: {
        ...requestWithoutBinding,
        ...(safeBinding ? { browserBinding: safeBinding } : {}),
      },
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
    if (
      this.runTaskOverride &&
      !verifying &&
      !input.clientTaskId.startsWith('authoring-locate:') &&
      !input.clientTaskId.startsWith('authoring:')
    ) {
      Object.assign(task, this.runTaskOverride);
    }
    if (this.authoringTaskOverride && input.clientTaskId.startsWith('authoring:')) {
      Object.assign(task, this.authoringTaskOverride);
    }
    this.tasks.set(taskId, task);
    return task;
  }

  async getTask(taskId: string): Promise<AgentTaskView> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error('task not created');
    return task;
  }

  async listTaskActivity(taskId: string, afterSeq = 0) {
    if (afterSeq >= 1) return [];
    return [
      {
        schema: AGENT_STREAM_EVENT_SCHEMA,
        streamId: taskId,
        turnId: `task:${taskId}`,
        sectionId: `task:${taskId}:agent`,
        seq: 1,
        occurredAt: new Date().toISOString(),
        type: 'section.upsert' as const,
        section: {
          type: 'activity' as const,
          sectionId: `task:${taskId}:agent`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          kind: 'agent' as const,
          state: 'completed' as const,
          title: '页面 Agent 已完成',
        },
      },
    ];
  }

  async commandTask(
    taskId: string,
    input: AgentTaskCommandRequest
  ): Promise<AgentTaskCommandResult> {
    const task = await this.getTask(taskId);
    this.commands.push(input.type);
    task.status =
      input.type === 'pause' ? 'paused' : input.type === 'resume' ? 'running' : 'cancelled';
    task.stateVersion += 1;
    task.eventSeq += 1;
    task.updatedAt = new Date().toISOString();
    if (task.status === 'cancelled') task.completedAt = task.updatedAt;
    return {
      task,
      command: {
        id: input.commandId,
        taskId,
        type: input.type,
        expectedStateVersion: input.expectedStateVersion,
        requestHash: 'a'.repeat(64),
        status: 'completed',
        createdBy: input.createdBy ?? 'test',
        createdAt: task.updatedAt,
        completedAt: task.updatedAt,
      },
    };
  }
}

class FakeBrowserClient implements SemanticBrowserClientPort {
  sessionId = SESSION_ID;
  closed = false;
  closedWithLease = false;
  revoked = false;
  capabilityCalls = 0;
  createSessionError?: Error;
  capabilities: BrowserExecutionCapabilities = {
    schema: 'nebula.service-capabilities/1.0',
    service: 'proxy-adapter',
    serviceVersion: '2.0.0',
    generatedAt: '2026-10-03T00:00:00.000Z',
    protocols: { browserExecution: { major: 1, minor: 0 } },
    features: { localControlPlane: true },
    limits: { maxActiveBrowserSessions: 1, maxBrowserContextsPerSession: 1 },
  };
  private activeLease?: BrowserLeaseView;
  private leaseCounter = 0;
  artifact?: { id: string; kind: string; sha256: string; mimeType: string; bytes: Buffer };
  artifacts?: NonNullable<FakeBrowserClient['artifact']>[];
  operationStatus: BrowserOperationRecord['status'] = 'succeeded';
  operationErrors = new Map<string, Error>();
  artifactErrors = new Map<string, Error>();

  async getCapabilities(): Promise<BrowserExecutionCapabilities> {
    this.capabilityCalls += 1;
    return this.capabilities;
  }

  async createSession(): Promise<BrowserSessionView> {
    if (this.createSessionError) throw this.createSessionError;
    this.closed = false;
    return this.session();
  }

  async getSession(): Promise<BrowserSessionView> {
    return this.session();
  }

  async listSessionEvents(): Promise<BrowserSessionEventRecord[]> {
    return [];
  }

  async createLease(
    _sessionId: string,
    _idempotencyKey: string,
    input: CreateBrowserLeaseRequest
  ): Promise<{ lease: BrowserLeaseView; token: string; tokenIssued: true }> {
    this.leaseCounter += 1;
    const leaseId = `10000000-0000-4000-8000-${String(this.leaseCounter).padStart(12, '0')}`;
    this.activeLease = {
      id: leaseId,
      sessionId: this.sessionId,
      mode: input.mode,
      sequence: 1,
      processEpoch: 1,
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

  async closeSession(
    _sessionId: string,
    _idempotencyKey: string,
    credentials?: { leaseId: string; leaseToken: string }
  ): Promise<BrowserSessionView> {
    this.closedWithLease = Boolean(
      credentials?.leaseId === this.activeLease?.id &&
      credentials?.leaseToken === 'opaque-lease-token'
    );
    if (!this.closedWithLease)
      throw new IntegrationClientError(
        'proxy-adapter',
        'permission_denied',
        'active session requires control credentials',
        false,
        403
      );
    this.activeLease = undefined;
    this.closed = true;
    return this.session('closed');
  }

  async getOperation(operationId: string): Promise<BrowserOperationRecord> {
    const error = this.operationErrors.get(operationId);
    if (error) throw error;
    return {
      schema: 'nebula.browser.operation-result/1.0',
      operationId,
      requestHash: HASH_A,
      queueSequence: 1,
      acceptedAt: new Date().toISOString(),
      sessionId: this.sessionId,
      leaseId: this.activeLease?.id ?? LEASE_ID,
      leaseSequence: 1,
      tabId: TAB_ID,
      kind: 'observe' as const,
      operation: 'page_state',
      status: this.operationStatus,
      actual: { url: 'https://test.example/account' },
      artifacts: (this.artifacts ?? (this.artifact ? [this.artifact] : [])).map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        sha256: artifact.sha256,
        mimeType: artifact.mimeType,
        sizeBytes: artifact.bytes.byteLength,
      })),
    };
  }

  async downloadArtifact(_sessionId: string, artifactId: string): Promise<Buffer> {
    const error = this.artifactErrors.get(artifactId);
    if (error) throw error;
    const artifact = (this.artifacts ?? (this.artifact ? [this.artifact] : [])).find(
      (item) => item.id === artifactId
    );
    if (!artifact) throw new Error('not used');
    return artifact.bytes;
  }

  private session(
    status: BrowserSessionView['status'] = this.closed ? 'closed' : 'active'
  ): BrowserSessionView {
    return {
      id: this.sessionId,
      status,
      processEpoch: 1,
      cdpPort: 9222,
      tabs: [{ id: TAB_ID, url: 'https://test.example/account', title: 'Account', isActive: true }],
      activeLeases: this.activeLease ? [this.activeLease] : [],
      liveView: { available: true, controlAllowed: false },
      viewport: { width: 1920, height: 1080 },
      createdAt: new Date().toISOString(),
    };
  }
}

function createFixture(db: DatabaseSync, assets: SemanticAssetRepository, highRisk = false) {
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
      environment: highRisk ? 'staging' : 'test',
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
    payload: functionalScriptFixture({
      scriptKey: 'account.view',
      name: '查看账号',
      moduleId: module.id,
      pageId: page.id,
      ...(highRisk ? deleteEffectScript() : {}),
    }),
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
    businessModuleId: businessModule.id,
    scriptId: script.id,
    scriptRevisionId: script.currentRevision.id,
    scriptPayload: script.currentRevision.payload,
    scriptRevisionSha256: script.currentRevision.contentSha256,
    pageRevisionId: page.currentRevision.id,
    scenarioId: scenario.id,
    moduleRevisionId: module.currentRevision.id,
    modulePayload: module.currentRevision.payload,
  };
}

function deleteEffectScript() {
  return {
    steps: [
      {
        id: 'step_effect',
        name: '受控删除',
        intent: '执行已声明删除',
        action: {
          type: 'click',
          target: {
            semantic: '删除',
            candidates: [
              { strategy: 'role', role: 'button', name: { kind: 'literal', value: '删除' } },
            ],
            expected: { cardinality: 'exactly_one' },
          },
        },
        sideEffectId: 'effect',
        postconditions: [],
      },
    ],
    sideEffects: [
      {
        id: 'effect',
        kind: 'delete',
        resourceType: 'fixture',
        identityFrom: { kind: 'literal', value: 'fixture' },
        affectedItems: { kind: 'single' },
        reversibility: 'compensatable',
        retryPolicy: 'verify_before_retry',
        verifyApplied: [
          {
            id: 'applied',
            kind: 'page.url',
            expected: { kind: 'literal', value: '/' },
            comparator: 'contains',
            message: '确认已应用',
          },
        ],
      },
    ],
  };
}
