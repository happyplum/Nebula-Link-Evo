import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up as up014 } from '../../migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../migrations/017-semantic-evidence-integration-foundation.js';
import {
  BusinessVersionRepository,
  BusinessVersionRepositoryError,
} from '../business-version-repository.js';
import { functionalScriptFixture } from '../../../test-support/functional-script-fixture.js';

describe('BusinessVersionRepository', () => {
  let db: DatabaseSync;
  let repository: BusinessVersionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'P')").run();
    up014(db);
    up015(db);
    up016(db);
    up017(db);
    repository = new BusinessVersionRepository(db);
  });

  afterEach(() => db.close());

  it('creates blank versions idempotently and rejects a changed request', () => {
    const first = repository.create({
      projectId: 'project-1',
      versionKey: 'release-1',
      name: 'Release 1',
      createdBy: 'user-1',
      requestId: 'create-1',
      git: { ref: 'main', commit: 'abc123' },
    });
    const replay = repository.create({
      projectId: 'project-1',
      versionKey: 'release-1',
      name: 'Release 1',
      createdBy: 'user-1',
      requestId: 'create-1',
      git: { ref: 'main', commit: 'abc123' },
    });

    expect(first.created).toBe(true);
    expect(replay).toMatchObject({ created: false, version: { id: first.version.id } });
    expect(() =>
      repository.create({
        projectId: 'project-1',
        versionKey: 'release-2',
        name: 'Changed',
        createdBy: 'user-1',
        requestId: 'create-1',
      })
    ).toThrow(BusinessVersionRepositoryError);
    expect(() =>
      repository.create({
        projectId: 'project-1',
        versionKey: 'secret-git',
        name: 'Secret Git',
        createdBy: 'user-1',
        requestId: 'create-secret-git',
        git: { repository: 'https://user:token@example.test/repository.git' },
      })
    ).toThrow(BusinessVersionRepositoryError);
  });

  it('deep copies current assets with remapped references and stale executable assets', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO deployment_profiles (id, project_id, profile_key, name, created_at)
       VALUES ('deployment', 'project-1', 'local', 'Local', ?)`
    ).run(now);
    db.prepare(
      `INSERT INTO deployment_profile_revisions
        (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
         content_sha256, validation_status, change_reason, created_by_type, created_at)
       VALUES ('deployment-revision', 'deployment', 1, 'current',
         'nebula.ai-e2e.deployment-profile/1.0', '{}',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'valid', 'test fixture', 'system', ?)`
    ).run(now);
    const source = repository.create({
      projectId: 'project-1',
      versionKey: 'source',
      name: 'Source',
      createdBy: 'user-1',
      requestId: 'create-source',
      git: { ref: 'main' },
      deploymentRevisionId: 'deployment-revision',
    }).version;
    const page = repository.createPage({
      businessVersionId: source.id,
      pageKey: 'login',
      payload: {
        schema: 'nebula.ai-e2e.page-definition/1.0',
        name: '登录页',
        routeMode: 'path',
        routeTemplate: '/login',
        identityQuery: {},
        runtimeParams: {},
        ignoredQueryKeys: [],
        authRequirement: { kind: 'anonymous' },
        recognition: [],
        allowedTransitionPageIds: [],
      },
      createdBy: 'system',
    });
    const businessModule = repository.createBusinessModule({
      businessVersionId: source.id,
      moduleKey: 'account',
      payload: {
        schema: 'nebula.ai-e2e.business-module/1.0',
        name: '账号',
        sortOrder: 0,
        prdSourceRefs: [],
      },
      createdBy: 'system',
    });
    const functionalModule = repository.createFunctionalModule({
      businessVersionId: source.id,
      businessModuleId: businessModule.id,
      moduleKey: 'login',
      primaryPageDefinitionId: page.id,
      payload: {
        schema: 'nebula.ai-e2e.functional-module/1.0',
        name: '登录',
        sortOrder: 0,
        primaryPageDefinitionId: page.id,
      },
      createdBy: 'system',
    });
    const script = repository.createFunctionalScript({
      businessVersionId: source.id,
      functionalModuleId: functionalModule.id,
      scriptKey: 'login.success',
      name: '成功登录',
      payload: functionalScriptFixture({
        scriptKey: 'login.success',
        name: '成功登录',
        moduleId: functionalModule.id,
        pageId: page.id,
      }),
      createdBy: 'system',
      readinessStatus: 'verified',
    });
    repository.createScenario({
      businessVersionId: source.id,
      scenarioKey: 'login-flow',
      name: '登录流程',
      payload: {
        schema: 'nebula.ai-e2e.scenario/1.0',
        scenarioKey: 'login-flow',
        name: '登录流程',
        purpose: '验证登录',
        prdSourceRefs: [],
        actors: [],
        initialAuth: { kind: 'anonymous' },
        inputs: [],
        finalAcceptance: [],
        calls: [
          {
            callKey: 'login',
            functionalScriptId: script.id,
            authContext: { before: { kind: 'anonymous' }, after: { kind: 'unchanged' } },
            inputBindings: {},
            outputAliases: {},
            role: 'normal',
            sortOrder: 0,
          },
        ],
        edges: [],
        exports: [],
      },
      createdBy: 'system',
      readinessStatus: 'verified',
    });
    db.prepare(
      `INSERT INTO version_prd_documents
        (id, business_version_id, document_key, format, raw_content, content_sha256,
         parsed_json, is_current, created_at)
       VALUES ('prd-source', ?, 'prd', 'markdown', '# PRD',
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ?, 1, ?)`
    ).run(source.id, JSON.stringify({ pageDefinitionId: page.id }), new Date().toISOString());
    db.prepare(
      `INSERT INTO version_variable_definitions
        (id, business_version_id, name, type, sensitivity, constraints_json, created_at)
       VALUES ('variable-source', ?, 'createdUserId', 'string', 'public', ?, ?)`
    ).run(source.id, JSON.stringify({ sourceDocumentId: 'prd-source' }), new Date().toISOString());
    db.prepare(
      `INSERT INTO version_decisions
        (id, business_version_id, decision_key, status, question, category, answer, reason,
         evidence_refs_json, decided_by_type, decided_by_id, created_at)
       VALUES ('decision-source', ?, 'login.scope', 'active', '覆盖登录吗', 'scope',
         '覆盖', 'PRD 要求', ?, 'user', 'user-1', ?)`
    ).run(source.id, JSON.stringify([page.id]), now);
    db.prepare(
      `INSERT INTO page_baseline_variants
        (id, business_version_id, page_definition_id, variant_key, created_at)
       VALUES ('baseline-source', ?, ?, 'default', ?)`
    ).run(source.id, page.id, now);
    db.prepare(
      `INSERT INTO artifact_objects
        (id, sha256, size_bytes, media_type, storage_backend, storage_key, sensitivity,
         redaction_status, ref_count, created_at)
       VALUES ('blob-1',
         'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 100,
         'image/png', 'local', 'baseline/blob-1.png', 'sensitive', 'redacted', 1, ?)`
    ).run(now);
    db.prepare(
      `INSERT INTO page_baseline_revisions
        (id, business_version_id, page_baseline_variant_id, revision_no, lifecycle, schema_id,
         payload_json, content_sha256, validation_status, change_reason, created_by_type,
         created_by_id, created_at, validated_at)
       VALUES ('baseline-revision-source', ?, 'baseline-source', 1, 'current',
         'nebula.ai-e2e.page-baseline/1.0', ?,
         'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
         'valid', 'fixture', 'system', 'system', ?, ?)`
    ).run(
      source.id,
      JSON.stringify({ pageDefinitionId: page.id, screenshotArtifactId: 'blob-1' }),
      now,
      now
    );
    db.prepare(
      `INSERT INTO module_requirement_revisions
        (id, business_version_id, functional_module_id, revision_no, lifecycle, schema_id,
         payload_json, content_sha256, validation_status, change_reason, created_by_type,
         created_by_id, created_at, validated_at)
       VALUES ('requirement-source', ?, ?, 1, 'current',
         'nebula.ai-e2e.module-requirement/1.0', ?,
         'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
         'valid', 'fixture', 'system', 'system', ?, ?)`
    ).run(
      source.id,
      functionalModule.id,
      JSON.stringify({
        functionalModuleId: functionalModule.id,
        sourceDecisionId: 'decision-source',
      }),
      now,
      now
    );
    db.prepare(
      `INSERT INTO functional_point_coverage
        (id, business_version_id, functional_module_id, module_requirement_revision_id,
         functional_point_key, required, disposition, functional_script_id,
         functional_script_revision_id, decision_id, lifecycle, reason_json, created_at)
       VALUES ('coverage-source', ?, ?, 'requirement-source', 'login.success', 1,
         'covered_by_script', ?, ?, 'decision-source', 'current', ?, ?)`
    ).run(
      source.id,
      functionalModule.id,
      script.id,
      script.currentRevision.id,
      JSON.stringify({ sourceRevisionId: 'requirement-source' }),
      now
    );
    db.prepare(
      `INSERT INTO asset_revision_dependencies
        (id, business_version_id, from_asset_type, from_asset_id, from_revision_id,
         to_asset_type, to_asset_id, to_revision_id, relation, source_pointer, created_at)
       VALUES ('dependency-source', ?, 'functional_script', ?, ?, 'module_requirement', ?,
         'requirement-source', 'requirement_source', '/requirementRevisionId', ?)`
    ).run(source.id, script.id, script.currentRevision.id, functionalModule.id, now);
    db.prepare(
      `INSERT INTO asset_revision_verifications
        (id, business_version_id, asset_type, asset_id, asset_revision_id,
         deployment_revision_id, verification_scope_sha256, verification_scope_json,
         dependency_closure_sha256, status, is_current, verified_at, created_at)
       VALUES ('verification-source', ?, 'functional_script', ?, ?, 'deployment-revision',
         'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', '{}',
         'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
         'verified', 1, ?, ?)`
    ).run(source.id, script.id, script.currentRevision.id, now, now);
    repository.setValidationStatus(source.id, 'valid');

    const copied = repository.copy({
      sourceVersionId: source.id,
      versionKey: 'copy',
      name: 'Copy',
      createdBy: 'user-1',
      copyRequestId: 'copy-1',
      git: { ref: 'release/copy' },
    });
    const replay = repository.copy({
      sourceVersionId: source.id,
      versionKey: 'copy',
      name: 'Copy',
      createdBy: 'user-1',
      copyRequestId: 'copy-1',
      git: { ref: 'release/copy' },
    });
    const graph = repository.getAssetGraph(copied.version.id);
    const copiedDocument = db
      .prepare(
        `SELECT id, parsed_json FROM version_prd_documents
         WHERE business_version_id = ? AND is_current = 1`
      )
      .get(copied.version.id) as { id: string; parsed_json: string };
    const copiedVariable = db
      .prepare(
        `SELECT id, constraints_json FROM version_variable_definitions
         WHERE business_version_id = ?`
      )
      .get(copied.version.id) as { id: string; constraints_json: string };
    const copiedDecision = db
      .prepare(
        `SELECT id, evidence_refs_json FROM version_decisions
         WHERE business_version_id = ? AND status = 'active'`
      )
      .get(copied.version.id) as { id: string; evidence_refs_json: string };
    const copiedBaseline = db
      .prepare(
        `SELECT v.id AS variant_id, v.page_definition_id, r.id AS revision_id, r.payload_json
         FROM page_baseline_variants v
         JOIN page_baseline_revisions r ON r.page_baseline_variant_id = v.id
         WHERE v.business_version_id = ? AND r.lifecycle = 'current'`
      )
      .get(copied.version.id) as {
      variant_id: string;
      page_definition_id: string;
      revision_id: string;
      payload_json: string;
    };
    const copiedRequirement = db
      .prepare(
        `SELECT id, functional_module_id, payload_json FROM module_requirement_revisions
         WHERE business_version_id = ? AND lifecycle = 'current'`
      )
      .get(copied.version.id) as {
      id: string;
      functional_module_id: string;
      payload_json: string;
    };
    const copiedCoverage = db
      .prepare(
        `SELECT * FROM functional_point_coverage
         WHERE business_version_id = ? AND lifecycle = 'current'`
      )
      .get(copied.version.id) as Record<string, unknown>;
    const copiedDependency = db
      .prepare('SELECT * FROM asset_revision_dependencies WHERE business_version_id = ?')
      .get(copied.version.id) as Record<string, unknown>;

    expect(copied.created).toBe(true);
    expect(replay).toMatchObject({ created: false, version: { id: copied.version.id } });
    expect(copied.version).toMatchObject({
      sourceVersionId: source.id,
      validationStatus: 'needs_recheck',
      git: { ref: 'release/copy' },
    });
    expect(repository.findDetail(copied.version.id)?.deploymentBindings).toEqual([
      {
        bindingKey: 'default',
        deploymentRevisionId: 'deployment-revision',
        isDefault: true,
      },
    ]);
    expect(graph.pages[0]!.id).not.toBe(page.id);
    expect(graph.functionalModules[0]!.primaryPageDefinitionId).toBe(graph.pages[0]!.id);
    expect(graph.functionalScripts[0]!.functionalModuleId).toBe(graph.functionalModules[0]!.id);
    expect(graph.scenarios[0]!.currentRevision.payload).toMatchObject({
      calls: [{ functionalScriptId: graph.functionalScripts[0]!.id }],
    });
    expect(graph.functionalScripts[0]!.currentRevision.readinessStatus).toBe('stale');
    expect(graph.scenarios[0]!.currentRevision.readinessStatus).toBe('stale');
    expect(JSON.stringify(graph.scenarios[0]!.currentRevision.payload)).not.toContain(script.id);
    expect(copiedDocument.id).not.toBe('prd-source');
    expect(JSON.parse(copiedDocument.parsed_json)).toEqual({
      pageDefinitionId: graph.pages[0]!.id,
    });
    expect(copiedVariable.id).not.toBe('variable-source');
    expect(JSON.parse(copiedVariable.constraints_json)).toEqual({
      sourceDocumentId: copiedDocument.id,
    });
    expect(copiedDecision.id).not.toBe('decision-source');
    expect(JSON.parse(copiedDecision.evidence_refs_json)).toEqual([graph.pages[0]!.id]);
    expect(copiedBaseline).toMatchObject({ page_definition_id: graph.pages[0]!.id });
    expect(copiedBaseline.variant_id).not.toBe('baseline-source');
    expect(copiedBaseline.revision_id).not.toBe('baseline-revision-source');
    expect(JSON.parse(copiedBaseline.payload_json)).toEqual({
      pageDefinitionId: graph.pages[0]!.id,
      screenshotArtifactId: 'blob-1',
    });
    expect(copiedRequirement.functional_module_id).toBe(graph.functionalModules[0]!.id);
    expect(JSON.parse(copiedRequirement.payload_json)).toEqual({
      functionalModuleId: graph.functionalModules[0]!.id,
      sourceDecisionId: copiedDecision.id,
    });
    expect(copiedCoverage).toMatchObject({
      functional_module_id: graph.functionalModules[0]!.id,
      module_requirement_revision_id: copiedRequirement.id,
      functional_script_id: graph.functionalScripts[0]!.id,
      functional_script_revision_id: graph.functionalScripts[0]!.currentRevision.id,
      decision_id: copiedDecision.id,
    });
    expect(copiedDependency).toMatchObject({
      from_asset_id: graph.functionalScripts[0]!.id,
      from_revision_id: graph.functionalScripts[0]!.currentRevision.id,
      to_asset_id: graph.functionalModules[0]!.id,
      to_revision_id: copiedRequirement.id,
    });
    expect(db.prepare("SELECT ref_count FROM artifact_objects WHERE id = 'blob-1'").get()).toEqual({
      ref_count: 2,
    });
    expect(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM asset_revision_verifications WHERE business_version_id = ?'
        )
        .get(copied.version.id)
    ).toEqual({ count: 0 });
  });

  it('rolls back copy when the source graph contains a dangling scenario reference', () => {
    const source = repository.create({
      projectId: 'project-1',
      versionKey: 'broken',
      name: 'Broken',
      createdBy: 'user-1',
      requestId: 'create-broken',
    }).version;
    const brokenPayload = {
      schema: 'nebula.ai-e2e.scenario/1.0',
      scenarioKey: 'broken-flow',
      name: 'Broken flow',
      purpose: 'broken',
      prdSourceRefs: [],
      actors: [],
      initialAuth: { kind: 'anonymous' },
      inputs: [],
      finalAcceptance: [],
      calls: [
        {
          callKey: 'missing',
          functionalScriptId: 'missing-script',
          authContext: { before: { kind: 'anonymous' }, after: { kind: 'unchanged' } },
          inputBindings: {},
          outputAliases: {},
          role: 'normal',
          sortOrder: 0,
        },
      ],
      edges: [],
      exports: [],
    };
    db.prepare(
      `INSERT INTO semantic_test_scenarios
        (id, business_version_id, scenario_key, name, created_at)
       VALUES ('broken-scenario', ?, 'broken-flow', 'Broken flow', ?)`
    ).run(source.id, new Date().toISOString());
    db.prepare(
      `INSERT INTO semantic_test_scenario_revisions
        (id, business_version_id, test_scenario_id, revision_no, lifecycle, schema_id,
         payload_json, content_sha256, validation_status, change_reason, created_by_type,
         created_at, readiness_status)
       VALUES ('broken-revision', ?, 'broken-scenario', 1, 'current',
         'nebula.ai-e2e.scenario/1.0', ?,
         'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'valid', 'corruption fixture', 'system', ?, 'verified')`
    ).run(source.id, JSON.stringify(brokenPayload), new Date().toISOString());
    repository.setValidationStatus(source.id, 'valid');

    expect(() =>
      repository.copy({
        sourceVersionId: source.id,
        versionKey: 'must-rollback',
        name: 'Must rollback',
        createdBy: 'user-1',
        copyRequestId: 'copy-broken',
      })
    ).toThrow(BusinessVersionRepositoryError);
    expect(repository.listByProject('project-1').map((version) => version.versionKey)).toEqual([
      'broken',
    ]);
  });
});
