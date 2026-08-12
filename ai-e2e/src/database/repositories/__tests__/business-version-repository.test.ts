import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up } from '../../migrations/014-semantic-asset-foundation.js';
import {
  BusinessVersionRepository,
  BusinessVersionRepositoryError,
} from '../business-version-repository.js';

describe('BusinessVersionRepository', () => {
  let db: DatabaseSync;
  let repository: BusinessVersionRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
    db.prepare("INSERT INTO projects (id, name) VALUES ('project-1', 'P')").run();
    up(db);
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
      payload: {
        schema: 'nebula.ai-e2e.functional-script/1.0',
        scriptKey: 'login.success',
        functionalModuleId: functionalModule.id,
        entryPageDefinitionId: page.id,
        steps: [],
      },
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
