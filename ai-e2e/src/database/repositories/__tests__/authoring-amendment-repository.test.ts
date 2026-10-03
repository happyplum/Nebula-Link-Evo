import { sideEffectPolicyCases } from '../../../test-support/side-effect-policy-cases.js';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { up as up014 } from '../../migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../migrations/018-authoring-amendments.js';
import { AuthoringAmendmentRepository } from '../authoring-amendment-repository.js';
import { BusinessVersionRepository } from '../business-version-repository.js';
import { SemanticAssetRepository } from '../semantic-asset-repository.js';
import { hashValue } from '../semantic-repository-utils.js';
import { SemanticWorkflowRepository } from '../semantic-workflow-repository.js';
import { functionalScriptFixture } from '../../../test-support/functional-script-fixture.js';

const HASH_A = 'a'.repeat(64);

describe('authoring amendment repository', () => {
  let db: DatabaseSync;
  let versions: BusinessVersionRepository;
  let assets: SemanticAssetRepository;
  let amendments: AuthoringAmendmentRepository;
  let fixture: ReturnType<typeof createFixture>;

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
    versions = new BusinessVersionRepository(db);
    assets = new SemanticAssetRepository(db);
    amendments = new AuthoringAmendmentRepository(db, assets);
    fixture = createFixture(db, versions);
  });

  afterEach(() => db.close());

  it.each(sideEffectPolicyCases)(
    'Authoring matrix $environment $kind => $result',
    ({ environment, kind, reversibility, result }) => {
      bindEnvironment(db, fixture.versionId, environment);
      const candidate = createEffectAmendment(
        amendments,
        assets,
        fixture,
        'matrix',
        kind,
        reversibility
      );
      const evaluation = amendments.policy.getAuthoringEvaluation(candidate.id)!;
      expect(evaluation.result).toBe(result);
      expect(candidate.state).toBe(
        result === 'denied'
          ? 'failed'
          : result === 'approval_required'
            ? 'waiting_decision'
            : 'candidate_ready'
      );
      if (result !== 'auto_allowed')
        expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow();
    }
  );

  it('persists an exact grant across restart; a replayed answer cannot revive revocation', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(amendments, assets, fixture, 'restart');
    const decision = candidate.decisions.find(
      (entry) => entry.category === 'side_effect_approval'
    )!;
    expect(decision).toMatchObject({ category: 'side_effect_approval', status: 'open' });
    const answer = {
      amendmentId: candidate.id,
      decisionId: String(decision.id),
      answer: 'approve' as const,
      reason: '精确批准',
      answeredBy: 'operator',
    };
    amendments.answerDecision(answer);
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    amendments = new AuthoringAmendmentRepository(db, assets);
    expect(amendments.policy.requireAuthoringAuthorization(candidate.id)?.grant?.grantId).toBe(
      grant.id
    );
    expect(amendments.answerDecision(answer).state).toBe('candidate_ready');
    expect(db.prepare('SELECT COUNT(*) AS count FROM side_effect_approval_grants').get()).toEqual({
      count: 1,
    });
    db.prepare(
      "UPDATE side_effect_approval_grants SET status = 'revoked', revoked_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), grant.id);
    expect(amendments.answerDecision(answer).state).toBe('candidate_ready');
    expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow(/approval/);
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('revoked');
  });

  it('rejects expired, missing and deployment-drifted approvals before queueing', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(amendments, assets, fixture, 'drift');
    amendments.answerDecision({
      amendmentId: candidate.id,
      decisionId: candidate.decisionIds[0],
      answer: 'approve',
      reason: '精确批准',
      answeredBy: 'operator',
    });
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    bindEnvironment(db, fixture.versionId, 'test');
    expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow(/stale/);
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('expired');
  });

  it('classifies an unrebuildable frozen verification as stale and retains the original cause', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(amendments, assets, fixture, 'unsupported-drift');
    amendments.answerDecision({
      amendmentId: candidate.id,
      decisionId: candidate.decisionIds[0],
      answer: 'approve',
      reason: '批准冻结计划',
      answeredBy: 'operator',
    });
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    const cause = new Error('changed dependency has unsupported browser steps');
    const rebuild = vi.spyOn(amendments.policy, 'buildAuthoringPlan').mockImplementationOnce(() => {
      throw cause;
    });
    try {
      expect(() => amendments.policy.requireAuthoringAuthorization(candidate.id)).toThrow(
        expect.objectContaining({ code: 'side_effect_approval_stale', cause })
      );
      expect(amendments.policy.getGrant(grant.id)?.status).toBe('expired');
    } finally {
      rebuild.mockRestore();
    }
  });

  it('an auto-allowed candidate does not inherit another amendment grant', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const old = createEffectAmendment(amendments, assets, fixture, 'high-risk');
    amendments.answerDecision({
      amendmentId: old.id,
      decisionId: old.decisionIds[0],
      answer: 'approve',
      reason: '只批准删除候选',
      answeredBy: 'operator',
    });
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    const current = createEffectAmendment(amendments, assets, fixture, 'low-risk', 'create');
    expect(amendments.policy.requireAuthoringAuthorization(current.id)).toMatchObject({
      policyResult: 'auto_allowed',
    });
    expect(amendments.policy.requireAuthoringAuthorization(current.id)?.grant).toBeUndefined();
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('active');
  });

  it('allows rejecting an old side-effect decision after deployment drift', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(amendments, assets, fixture, 'reject-drift');
    bindEnvironment(db, fixture.versionId, 'test');
    expect(
      amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId: candidate.decisionIds[0],
        answer: 'reject',
        reason: '拒绝旧部署计划',
        answeredBy: 'operator',
      }).state
    ).toBe('rejected');
    expect(
      amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })
    ).toBeUndefined();
  });

  it('a late old candidate check cannot invalidate a newer candidate grant', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const old = createEffectAmendment(amendments, assets, fixture, 'old');
    const current = createEffectAmendment(amendments, assets, fixture, 'current');
    for (const candidate of [old, current])
      amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId: candidate.decisionIds[0],
        answer: 'approve',
        reason: '精确批准',
        answeredBy: 'operator',
      });
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    expect(() => amendments.policy.requireAuthoringAuthorization(old.id)).toThrow(/binding/);
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('active');
    expect(amendments.policy.requireAuthoringAuthorization(current.id)?.grant?.grantId).toBe(
      grant.id
    );
  });

  it('scope approval cannot authorize a side effect, and terminal context expires the grant atomically', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(
      amendments,
      assets,
      fixture,
      'scope',
      'delete',
      'compensatable',
      true
    );
    const scope = candidate.decisions.find(
      (entry) => entry.category === 'authoring_scope_expansion'
    )!;
    const effect = candidate.decisions.find((entry) => entry.category === 'side_effect_approval')!;
    expect(
      amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId: String(scope.id),
        answer: 'approve',
        reason: '仅范围',
        answeredBy: 'operator',
      }).state
    ).toBe('waiting_decision');
    expect(
      amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })
    ).toBeUndefined();
    expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow();
    amendments.answerDecision({
      amendmentId: candidate.id,
      decisionId: String(effect.id),
      answer: 'approve',
      reason: '明确副作用',
      answeredBy: 'operator',
    });
    new SemanticWorkflowRepository(db).settleAuthoringJob(fixture.jobId, 'completed', {
      code: 'test_terminal',
    });
    expect(
      amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })
    ).toBeUndefined();
    expect(() => amendments.policy.requireAuthoringAuthorization(candidate.id)).toThrow(
      /terminated/
    );
  });

  it.each(['side_effect_approval', 'authoring_scope_expansion'])(
    'withdraws sibling approvals when %s is rejected without changing another candidate',
    (category) => {
      bindEnvironment(db, fixture.versionId, 'staging');
      const candidate = createEffectAmendment(
        amendments,
        assets,
        fixture,
        'reject-both',
        'delete',
        'compensatable',
        true
      );
      const other = createEffectAmendment(
        amendments,
        assets,
        fixture,
        'other-open',
        'delete',
        'compensatable',
        true
      );
      const decision = candidate.decisions.find((entry) => entry.category === category)!;
      const answer = {
        amendmentId: candidate.id,
        decisionId: String(decision.id),
        answer: 'reject' as const,
        reason: '拒绝候选',
        answeredBy: 'operator',
      };
      const rejected = amendments.answerDecision(answer);
      expect(rejected.state).toBe('rejected');
      expect(rejected.decisions.filter((entry) => entry.status === 'open')).toEqual([]);
      expect(rejected.decisions.find((entry) => entry.id === decision.id)).toMatchObject({
        status: 'answered',
        stateVersion: 2,
      });
      expect(rejected.decisions.find((entry) => entry.id !== decision.id)).toMatchObject({
        status: 'withdrawn',
        stateVersion: 2,
      });
      expect(amendments.getAmendment(other.id)?.decisions).toEqual(other.decisions);
      expect(amendments.answerDecision(answer)).toEqual(rejected);
      expect(
        db.prepare('SELECT decision_request_id, answer_key FROM decision_answers').all()
      ).toEqual([{ decision_request_id: decision.id, answer_key: 'reject' }]);
      expect(
        amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })
      ).toBeUndefined();
    }
  );

  it('withdraws scope approvals when the candidate is denied by production policy', () => {
    bindEnvironment(db, fixture.versionId, 'production');
    const candidate = createEffectAmendment(
      amendments,
      assets,
      fixture,
      'denied-scope',
      'delete',
      'compensatable',
      true
    );
    expect(candidate.state).toBe('failed');
    expect(candidate.decisions).toHaveLength(1);
    expect(candidate.decisions[0]).toMatchObject({
      category: 'authoring_scope_expansion',
      status: 'withdrawn',
      stateVersion: 2,
    });
    expect(db.prepare('SELECT * FROM decision_answers').all()).toEqual([]);
  });

  it.each(['fail', 'reject'] as const)(
    'withdraws remaining scope decisions on %s while retaining approved effect audit',
    (operation) => {
      bindEnvironment(db, fixture.versionId, 'staging');
      const candidate = createEffectAmendment(
        amendments,
        assets,
        fixture,
        'terminal-audit',
        'delete',
        'compensatable',
        true
      );
      const effect = candidate.decisions.find(
        (entry) => entry.category === 'side_effect_approval'
      )!;
      amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId: String(effect.id),
        answer: 'approve',
        reason: '精确副作用',
        answeredBy: 'operator',
      });
      const answers = db.prepare('SELECT * FROM decision_answers').all();
      const approved = amendments
        .getAmendment(candidate.id)!
        .decisions.find((entry) => entry.id === effect.id);
      const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
      const terminal =
        operation === 'fail'
          ? amendments.fail(candidate.id, { code: 'verification_failed' })
          : amendments.reject(candidate.id, '撤回候选');
      expect(terminal.decisions.find((entry) => entry.id === effect.id)).toEqual(approved);
      expect(terminal.decisions.find((entry) => entry.id !== effect.id)).toMatchObject({
        status: 'withdrawn',
      });
      expect(db.prepare('SELECT * FROM decision_answers').all()).toEqual(answers);
      expect(amendments.policy.getGrant(grant.id)?.status).toBe('expired');
    }
  );

  it('withdraws open approvals on context switch and preserves answers and the new context', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(
      amendments,
      assets,
      fixture,
      'context-open',
      'delete',
      'compensatable',
      true
    );
    const scope = candidate.decisions.find(
      (entry) => entry.category === 'authoring_scope_expansion'
    )!;
    amendments.answerDecision({
      amendmentId: candidate.id,
      decisionId: String(scope.id),
      answer: 'approve',
      reason: '仅范围',
      answeredBy: 'operator',
    });
    const answers = db.prepare('SELECT * FROM decision_answers').all();
    const approved = amendments
      .getAmendment(candidate.id)!
      .decisions.find((entry) => entry.id === scope.id);
    const next = amendments.createContextThread({
      jobId: fixture.jobId,
      businessVersionId: fixture.versionId,
      scope: {
        currentUrl: '/login',
        currentPageDefinitionId: fixture.page1Id,
        currentFunctionalModuleId: fixture.module2Id,
        baseRevisionSha256: fixture.module2RevisionSha256,
        visibleScenarioIds: [],
      },
      createdBy: 'operator',
    });
    const stale = amendments.getAmendment(candidate.id)!;
    expect(stale.state).toBe('stale');
    expect(stale.decisions.find((entry) => entry.id === scope.id)).toEqual(approved);
    expect(stale.decisions.find((entry) => entry.id !== scope.id)).toMatchObject({
      status: 'withdrawn',
    });
    expect(db.prepare('SELECT * FROM decision_answers').all()).toEqual(answers);
    expect(
      db.prepare('SELECT state FROM authoring_context_threads WHERE id = ?').get(next.id)
    ).toEqual({ state: 'active' });
  });

  it('rolls back stale candidate and grant changes together when the stale write fails', () => {
    bindEnvironment(db, fixture.versionId, 'staging');
    const candidate = createEffectAmendment(
      amendments,
      assets,
      fixture,
      'stale-atomic',
      'delete',
      'compensatable',
      true
    );
    for (const decisionId of candidate.decisionIds)
      amendments.answerDecision({
        amendmentId: candidate.id,
        decisionId,
        answer: 'approve',
        reason: '批准精确计划',
        answeredBy: 'operator',
      });
    const grant = amendments.policy.getActiveGrant({ type: 'authoring', id: fixture.jobId })!;
    const replacement = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId,
      '新的验收'
    );
    assets.activateRevisions([
      { assetType: 'functional_module', revisionId: replacement.id, dependencies: [] },
    ]);
    db.exec(
      "CREATE TRIGGER fail_stale_write BEFORE UPDATE OF state ON authoring_amendments WHEN NEW.state = 'stale' BEGIN SELECT RAISE(ABORT, 'stale write failed'); END;"
    );
    expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow('stale write failed');
    expect(amendments.getAmendment(candidate.id)?.state).toBe('candidate_ready');
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('active');
    db.exec('DROP TRIGGER fail_stale_write');
    expect(() => amendments.queueAtSafeBoundary(candidate.id)).toThrow(
      'Amendment base revision changed'
    );
    expect(amendments.getAmendment(candidate.id)?.state).toBe('stale');
    expect(amendments.policy.getGrant(grant.id)?.status).toBe('expired');
  });

  it('allows current-module changes and activates the verified candidate at a safe boundary', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '更新登录验收目标'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-current-module',
      reason: '登录页文案和验收目标已变化',
      category: 'acceptance',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module1Id,
          baseRevisionId: fixture.module1RevisionId,
          baseRevisionSha256: fixture.module1RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module1Id,
          targetUrl: '/login',
          category: 'acceptance',
          diff: { acceptance: { from: '旧', to: '新' } },
        },
      ],
      validationPlan: { checks: ['module-schema', 'login-flow'] },
      createdBy: 'main-agent',
    });

    expect(created.amendment.state).toBe('candidate_ready');
    expect(created.amendment.decisionIds).toEqual([]);
    expect(amendments.queueAtSafeBoundary(created.amendment.id).state).toBe('verifying');
    expect(amendments.activate(created.amendment.id).state).toBe('activated');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module1Id)
    ).toEqual({ id: candidate.id });
  });

  it('requires a decision for another module on the same URL and preserves current on rejection', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId,
      '重排同页安全模块'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-other-module',
      reason: '建议调整同页其他模块',
      category: 'module_call',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module2Id,
          baseRevisionId: fixture.module2RevisionId,
          baseRevisionSha256: fixture.module2RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module2Id,
          targetUrl: '/login',
          category: 'module_call',
          diff: { order: { from: 2, to: 1 } },
        },
      ],
      validationPlan: { checks: ['same-page-regression'] },
      createdBy: 'main-agent',
    });

    expect(created.amendment.state).toBe('waiting_decision');
    expect(created.amendment.decisions[0]).toMatchObject({
      scopeKind: 'same_page_other_module',
      status: 'open',
      impact: {
        affectedFunctionalModuleIds: [fixture.module2Id],
        validationPlan: { checks: ['same-page-regression'] },
      },
    });
    const rejected = amendments.answerDecision({
      amendmentId: created.amendment.id,
      decisionId: created.amendment.decisionIds[0],
      answer: 'reject',
      reason: '不允许修改安全模块',
      answeredBy: 'user-1',
    });
    expect(rejected.state).toBe('rejected');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module2Id)
    ).toEqual({ id: fixture.module2RevisionId });
  });

  it('requires cross-URL approval and queues behind an active browser operation', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module3Id,
      fixture.module3RevisionId,
      '更新仪表盘模块调用'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'amend-cross-url',
      reason: '登录成功后需要调整仪表盘检查',
      category: 'module_call',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module3Id,
          baseRevisionId: fixture.module3RevisionId,
          baseRevisionSha256: fixture.module3RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page2Id,
          targetFunctionalModuleId: fixture.module3Id,
          targetUrl: '/dashboard',
          category: 'module_call',
          diff: { calls: { add: ['dashboard.loaded'] } },
        },
      ],
      validationPlan: { checks: ['login', 'dashboard'] },
      potentialSideEffects: { navigation: ['/dashboard'] },
      createdBy: 'main-agent',
    });
    expect(created.amendment.decisions[0]).toMatchObject({ scopeKind: 'cross_url' });
    expect(
      amendments.answerDecision({
        amendmentId: created.amendment.id,
        decisionId: created.amendment.decisionIds[0],
        answer: 'approve',
        reason: '批准跨 URL 验证',
        answeredBy: 'user-1',
      }).state
    ).toBe('candidate_ready');
    db.prepare(
      `INSERT INTO external_task_links
        (id, context_type, context_id, authoring_job_id, service, kind,
         external_id, external_state, created_at)
       VALUES ('operation-link', 'authoring', ?, ?, 'proxy_adapter', 'browser_operation',
         'operation-1', 'started', ?)`
    ).run(fixture.jobId, fixture.jobId, new Date().toISOString());

    expect(amendments.queueAtSafeBoundary(created.amendment.id).state).toBe(
      'queued_at_safe_boundary'
    );
    expect(() => amendments.beginQueuedVerification(created.amendment.id)).toThrow('safe boundary');
    db.prepare(
      "UPDATE external_task_links SET external_state = 'succeeded' WHERE id = 'operation-link'"
    ).run();
    expect(amendments.beginQueuedVerification(created.amendment.id).state).toBe('verifying');
  });

  it('marks old candidates stale when module context changes and blocks applying them', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '旧上下文候选'
    );
    const thread = createThread(amendments, fixture);
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: thread.id,
      idempotencyKey: 'stale-on-switch',
      reason: '旧模块候选',
      category: 'repair',
      changes: [
        {
          assetType: 'functional_module',
          assetId: fixture.module1Id,
          baseRevisionId: fixture.module1RevisionId,
          baseRevisionSha256: fixture.module1RevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module1Id,
          targetUrl: '/login',
          category: 'repair',
          diff: { selector: 'new' },
        },
      ],
      validationPlan: { checks: ['login'] },
      createdBy: 'main-agent',
    });
    amendments.createContextThread({
      jobId: fixture.jobId,
      businessVersionId: fixture.versionId,
      scope: {
        currentUrl: '/dashboard',
        currentPageDefinitionId: fixture.page2Id,
        currentFunctionalModuleId: fixture.module3Id,
        baseRevisionSha256: fixture.module3RevisionSha256,
        visibleScenarioIds: [],
      },
      createdBy: 'user-1',
    });

    expect(amendments.getAmendment(created.amendment.id)).toMatchObject({
      state: 'stale',
      staleReason: { code: 'context_changed' },
    });
    expect(() => amendments.queueAtSafeBoundary(created.amendment.id)).toThrow('ready candidate');
  });

  it('rejects a forged target module instead of trusting the candidate scope declaration', () => {
    const candidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module2Id,
      fixture.module2RevisionId,
      '伪造归属候选'
    );
    const thread = createThread(amendments, fixture);

    expect(() =>
      amendments.createAmendment({
        jobId: fixture.jobId,
        threadId: thread.id,
        idempotencyKey: 'forged-module-scope',
        reason: '尝试把其他模块伪装成当前模块',
        category: 'module_call',
        changes: [
          {
            assetType: 'functional_module',
            assetId: fixture.module2Id,
            baseRevisionId: fixture.module2RevisionId,
            baseRevisionSha256: fixture.module2RevisionSha256,
            candidateRevisionId: candidate.id,
            targetPageDefinitionId: fixture.page1Id,
            targetFunctionalModuleId: fixture.module1Id,
            targetUrl: '/login',
            category: 'module_call',
            diff: { order: 1 },
          },
        ],
        validationPlan: { checks: ['ownership'] },
        createdBy: 'main-agent',
      })
    ).toThrow('does not match the asset owner');
    expect(db.prepare('SELECT COUNT(*) AS count FROM authoring_amendments').get()).toEqual({
      count: 0,
    });
  });

  it('keeps every current revision unchanged when atomic activation validation fails', () => {
    const moduleCandidate = createModuleCandidate(
      assets,
      fixture,
      fixture.module1Id,
      fixture.module1RevisionId,
      '模块候选'
    );
    const scriptCandidate = assets.createRevision({
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      businessVersionId: fixture.versionId,
      schemaId: 'nebula.ai-e2e.functional-script/1.0',
      payload: functionalScriptFixture({
        scriptKey: 'login.success',
        name: '成功登录',
        moduleId: fixture.module1Id,
        pageId: fixture.page1Id,
      }),
      validationStatus: 'valid',
      changeReason: '未验证脚本候选',
      createdByType: 'child_agent',
      supersedesRevisionId: fixture.scriptRevisionId,
      primaryPageRevisionId: fixture.page1RevisionId,
      changeKind: 'ai_repair',
    });

    expect(() =>
      assets.activateRevisions([
        {
          assetType: 'functional_module',
          revisionId: moduleCandidate.id,
          dependencies: [],
        },
        {
          assetType: 'functional_script',
          revisionId: scriptCandidate.id,
          verificationScopeSha256: HASH_A,
          dependencyClosureSha256: HASH_A,
          dependencies: [],
        },
      ])
    ).toThrow('No verified record');
    expect(
      db
        .prepare(
          `SELECT id FROM semantic_functional_module_revisions
           WHERE functional_module_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.module1Id)
    ).toEqual({ id: fixture.module1RevisionId });
  });

  it('activates an executable candidate only after recording its exact verification', () => {
    const candidate = assets.createRevision({
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      businessVersionId: fixture.versionId,
      schemaId: 'nebula.ai-e2e.functional-script/1.0',
      payload: functionalScriptFixture({
        scriptKey: 'login.success',
        name: '成功登录',
        moduleId: fixture.module1Id,
        pageId: fixture.page1Id,
      }),
      validationStatus: 'valid',
      changeReason: '已验证脚本候选',
      createdByType: 'child_agent',
      supersedesRevisionId: fixture.scriptRevisionId,
      primaryPageRevisionId: fixture.page1RevisionId,
      changeKind: 'ai_repair',
    });
    const created = amendments.createAmendment({
      jobId: fixture.jobId,
      threadId: createThread(amendments, fixture).id,
      idempotencyKey: 'verified-executable-candidate',
      reason: '更新登录脚本',
      category: 'script',
      changes: [
        {
          assetType: 'functional_script',
          assetId: fixture.scriptId,
          baseRevisionId: fixture.scriptRevisionId,
          baseRevisionSha256: fixture.scriptRevisionSha256,
          candidateRevisionId: candidate.id,
          targetPageDefinitionId: fixture.page1Id,
          targetFunctionalModuleId: fixture.module1Id,
          targetUrl: '/login',
          category: 'script',
          diff: { steps: { add: ['click submit'] } },
        },
      ],
      validationPlan: { checks: ['real-browser'] },
      createdBy: 'main-agent',
    });
    amendments.queueAtSafeBoundary(created.amendment.id);

    expect(() => amendments.activate(created.amendment.id)).toThrow(
      'Executable activation requires exact verification scope and dependency closure'
    );

    const verificationScope = {
      schema: 'nebula.ai-e2e.verification-scope/1.0',
      deploymentRevisionId: 'deployment-revision',
      authoringJobId: fixture.jobId,
      agentTaskId: 'verification-task',
      verifiedAssetIds: [fixture.scriptId],
    };
    assets.recordVerification({
      id: 'verification-1',
      businessVersionId: fixture.versionId,
      assetType: 'functional_script',
      assetId: fixture.scriptId,
      assetRevisionId: candidate.id,
      deploymentRevisionId: 'deployment-revision',
      verificationScope,
      dependencyClosureSha256: HASH_A,
      status: 'verified',
      authoringJobId: fixture.jobId,
    });
    expect(() =>
      amendments.recordCandidateVerification(created.amendment.id, [
        {
          candidateRevisionId: 'not-an-amendment-candidate',
          verificationScopeSha256: hashValue(verificationScope),
          dependencyClosureSha256: HASH_A,
        },
      ])
    ).toThrow('does not match an amendment change');
    amendments.recordCandidateVerification(created.amendment.id, [
      {
        candidateRevisionId: candidate.id,
        verificationScopeSha256: hashValue(verificationScope),
        dependencyClosureSha256: HASH_A,
      },
    ]);

    expect(amendments.activate(created.amendment.id, 'verification-task').state).toBe('activated');
    expect(
      db
        .prepare(
          `SELECT id FROM functional_script_revisions
           WHERE functional_script_id = ? AND lifecycle = 'current'`
        )
        .get(fixture.scriptId)
    ).toEqual({ id: candidate.id });
  });
});

function createThread(
  amendments: AuthoringAmendmentRepository,
  fixture: ReturnType<typeof createFixture>
) {
  return amendments.createContextThread({
    jobId: fixture.jobId,
    businessVersionId: fixture.versionId,
    scope: {
      currentUrl: '/login',
      currentPageDefinitionId: fixture.page1Id,
      currentFunctionalModuleId: fixture.module1Id,
      baseRevisionSha256: fixture.module1RevisionSha256,
      visibleScenarioIds: [],
    },
    createdBy: 'user-1',
  });
}

function createModuleCandidate(
  assets: SemanticAssetRepository,
  fixture: ReturnType<typeof createFixture>,
  moduleId: string,
  baseRevisionId: string,
  reason: string
) {
  return assets.createRevision({
    assetType: 'functional_module',
    assetId: moduleId,
    businessVersionId: fixture.versionId,
    schemaId: 'nebula.ai-e2e.functional-module/1.0',
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: reason,
      sortOrder: 1,
      primaryPageDefinitionId: moduleId === fixture.module3Id ? fixture.page2Id : fixture.page1Id,
    },
    validationStatus: 'valid',
    changeReason: reason,
    createdByType: 'main_agent',
    supersedesRevisionId: baseRevisionId,
  });
}

function createFixture(db: DatabaseSync, versions: BusinessVersionRepository) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO deployment_profiles (id, project_id, profile_key, name, created_at)
     VALUES ('deployment', 'project-1', 'test', 'Test', ?)`
  ).run(now);
  db.prepare(
    `INSERT INTO deployment_profile_revisions
      (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
       content_sha256, validation_status, change_reason, created_by_type, created_at)
     VALUES ('deployment-revision', 'deployment', 1, 'current', 'deployment/1', '{"environment":"test"}', ?,
       'valid', 'fixture', 'system', ?)`
  ).run(HASH_A, now);
  const version = versions.create({
    projectId: 'project-1',
    versionKey: 'release-1',
    name: 'Release 1',
    createdBy: 'system',
    requestId: 'create-version',
    deploymentRevisionId: 'deployment-revision',
  }).version;
  const page1 = createPage(versions, version.id, 'login', '/login');
  const page2 = createPage(versions, version.id, 'dashboard', '/dashboard');
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
  const module1 = createModule(versions, version.id, businessModule.id, page1.id, 'login');
  const module2 = createModule(versions, version.id, businessModule.id, page1.id, 'security');
  const module3 = createModule(versions, version.id, businessModule.id, page2.id, 'dashboard');
  const script = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: module1.id,
    scriptKey: 'login.success',
    name: '成功登录',
    payload: functionalScriptFixture({
      scriptKey: 'login.success',
      name: '成功登录',
      moduleId: module1.id,
      pageId: page1.id,
    }),
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  const workflow = new SemanticWorkflowRepository(db);
  const job = workflow.createAuthoringJob({
    projectId: 'project-1',
    businessVersionId: version.id,
    mode: 'repair',
    idempotencyKey: 'repair-job',
    stage: 'impact_analysis',
    strategyVersion: 'semantic-v1',
    sourceFingerprint: 'fixture',
    input: { reason: 'fixture' },
    createdBy: 'user-1',
  });
  return {
    versionId: version.id,
    jobId: job.id,
    page1Id: page1.id,
    page1RevisionId: page1.currentRevision.id,
    page2Id: page2.id,
    module1Id: module1.id,
    module1RevisionId: module1.currentRevision.id,
    module1RevisionSha256: module1.currentRevision.contentSha256,
    module2Id: module2.id,
    module2RevisionId: module2.currentRevision.id,
    module2RevisionSha256: module2.currentRevision.contentSha256,
    module3Id: module3.id,
    module3RevisionId: module3.currentRevision.id,
    module3RevisionSha256: module3.currentRevision.contentSha256,
    scriptId: script.id,
    scriptRevisionId: script.currentRevision.id,
    scriptRevisionSha256: script.currentRevision.contentSha256,
  };
}

function createPage(
  versions: BusinessVersionRepository,
  versionId: string,
  pageKey: string,
  routeTemplate: string
) {
  return versions.createPage({
    businessVersionId: versionId,
    pageKey,
    payload: {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: pageKey,
      routeMode: 'path',
      routeTemplate,
      identityQuery: {},
      runtimeParams: {},
      ignoredQueryKeys: [],
      authRequirement: { kind: 'anonymous' },
      recognition: [],
      allowedTransitionPageIds: [],
    },
    createdBy: 'system',
  });
}

function createModule(
  versions: BusinessVersionRepository,
  versionId: string,
  businessModuleId: string,
  pageId: string,
  moduleKey: string
) {
  return versions.createFunctionalModule({
    businessVersionId: versionId,
    businessModuleId,
    moduleKey,
    primaryPageDefinitionId: pageId,
    payload: {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: moduleKey,
      sortOrder: 0,
      primaryPageDefinitionId: pageId,
    },
    createdBy: 'system',
  });
}

function bindEnvironment(
  db: DatabaseSync,
  versionId: string,
  environment: 'local' | 'test' | 'staging' | 'production'
) {
  const id = `deployment-${environment}`;
  db.prepare(
    `INSERT INTO deployment_profile_revisions (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json, content_sha256, validation_status, change_reason, created_by_type, created_at) VALUES (?, 'deployment', ?, 'draft', 'deployment/1', ?, ?, 'valid', 'fixture', 'system', ?)`
  ).run(
    id,
    ['local', 'test', 'staging', 'production'].indexOf(environment) + 2,
    JSON.stringify({ environment }),
    hashValue({ environment }),
    new Date().toISOString()
  );
  db.prepare(
    'UPDATE version_deployment_bindings SET deployment_revision_id = ? WHERE business_version_id = ? AND is_default = 1'
  ).run(id, versionId);
}

function createEffectAmendment(
  amendments: AuthoringAmendmentRepository,
  assets: SemanticAssetRepository,
  fixture: ReturnType<typeof createFixture>,
  key: string,
  kind: 'create' | 'delete' | 'auth_change' = 'delete',
  reversibility = 'compensatable',
  scope = false
) {
  const payload = functionalScriptFixture({
    scriptKey: 'login.success',
    name: key,
    moduleId: fixture.module1Id,
    pageId: fixture.page1Id,
    steps: [
      {
        id: 'step_effect',
        name: '受控动作',
        intent: '执行已声明动作',
        action: {
          type: 'click',
          target: {
            semantic: '提交',
            candidates: [
              { strategy: 'role', role: 'button', name: { kind: 'literal', value: '提交' } },
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
        kind,
        resourceType: 'fixture',
        identityFrom: { kind: 'literal', value: 'fixture' },
        affectedItems: { kind: 'single' },
        reversibility,
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
  });
  const revision = assets.createRevision({
    assetType: 'functional_script',
    assetId: fixture.scriptId,
    businessVersionId: fixture.versionId,
    schemaId: 'nebula.ai-e2e.functional-script/1.0',
    payload,
    validationStatus: 'valid',
    changeReason: key,
    createdByType: 'child_agent',
    supersedesRevisionId: fixture.scriptRevisionId,
    primaryPageRevisionId: fixture.page1RevisionId,
  });
  const changes = [
    {
      assetType: 'functional_script' as const,
      assetId: fixture.scriptId,
      baseRevisionId: fixture.scriptRevisionId,
      baseRevisionSha256: fixture.scriptRevisionSha256,
      candidateRevisionId: revision.id,
      targetPageDefinitionId: fixture.page1Id,
      targetFunctionalModuleId: fixture.module1Id,
      targetUrl: '/login',
      category: 'script',
      diff: {},
    },
  ];
  const scopeCandidate = scope
    ? createModuleCandidate(
        assets,
        fixture,
        fixture.module2Id,
        fixture.module2RevisionId,
        '范围扩展'
      )
    : undefined;
  return amendments.createAmendment({
    jobId: fixture.jobId,
    threadId: createThread(amendments, fixture).id,
    idempotencyKey: key,
    reason: key,
    category: 'script',
    changes: [
      ...changes,
      ...(scopeCandidate
        ? [
            {
              assetType: 'functional_module' as const,
              assetId: fixture.module2Id,
              baseRevisionId: fixture.module2RevisionId,
              baseRevisionSha256: fixture.module2RevisionSha256,
              candidateRevisionId: scopeCandidate.id,
              targetPageDefinitionId: fixture.page1Id,
              targetFunctionalModuleId: fixture.module2Id,
              targetUrl: '/login',
              category: 'acceptance',
              diff: {},
            },
          ]
        : []),
    ],
    validationPlan: { checks: ['real-browser'] },
    createdBy: 'operator',
  }).amendment;
}
