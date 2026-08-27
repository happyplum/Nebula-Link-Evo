import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { up as up014 } from '../../migrations/014-semantic-asset-foundation.js';
import { up as up015 } from '../../migrations/015-semantic-asset-governance.js';
import { up as up016 } from '../../migrations/016-semantic-workflow-foundation.js';
import { up as up017 } from '../../migrations/017-semantic-evidence-integration-foundation.js';
import { up as up018 } from '../../migrations/018-authoring-amendments.js';
import { BusinessVersionRepository } from '../business-version-repository.js';
import { SemanticQueryRepository } from '../semantic-query-repository.js';
import { functionalScriptFixture } from '../../../test-support/functional-script-fixture.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

describe('SemanticQueryRepository', () => {
  let db: DatabaseSync;
  let versions: BusinessVersionRepository;
  let repository: SemanticQueryRepository;

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
    repository = new SemanticQueryRepository(db, versions);
  });

  afterEach(() => db.close());

  it('returns null without reading the graph for a missing version', () => {
    const getAssetGraph = vi.spyOn(versions, 'getAssetGraph');

    expect(repository.getWorkspace('missing-version')).toBeNull();
    expect(getAssetGraph).not.toHaveBeenCalled();

    getAssetGraph.mockRestore();
  });

  it('projects a present version with one graph read and preserved detail fields', () => {
    const fixture = createFixture(db, versions);
    const getAssetGraph = vi.spyOn(versions, 'getAssetGraph');

    const workspace = repository.getWorkspace(fixture.versionId);

    expect(getAssetGraph).toHaveBeenCalledTimes(1);
    expect(getAssetGraph).toHaveBeenCalledWith(fixture.versionId);
    expect(workspace).toMatchObject({
      schema: 'nebula.ai-e2e.workspace/1.0',
      version: {
        id: fixture.versionId,
        assets: {
          pages: 1,
          businessModules: 1,
          functionalModules: 1,
          functionalScripts: 2,
          scenarios: 2,
          staleExecutableAssets: 2,
        },
      },
      prdDocuments: [{ id: 'prd-1', documentKey: 'main', rawContent: '# 登录需求' }],
      pages: [{ id: fixture.pageId, pageKey: 'login' }],
      businessModules: [{ id: fixture.businessModuleId, moduleKey: 'account' }],
      functionalModules: [{ id: fixture.functionalModuleId, moduleKey: 'login' }],
      validations: [
        {
          id: 'validation-1',
          deploymentRevisionId: 'deployment-revision',
          status: 'valid',
        },
      ],
    });
    expect(workspace?.functionalScripts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.staleScriptId,
          scriptKey: 'login.stale',
          currentRevision: expect.objectContaining({ readinessStatus: 'stale' }),
        }),
        expect.objectContaining({ id: fixture.verifiedScriptId, scriptKey: 'login.success' }),
      ])
    );
    expect(workspace?.functionalScripts).toHaveLength(2);
    expect(workspace?.scenarios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.staleScenarioId,
          scenarioKey: 'login-stale',
          currentRevision: expect.objectContaining({ readinessStatus: 'stale' }),
        }),
        expect.objectContaining({ id: fixture.verifiedScenarioId, scenarioKey: 'login-success' }),
      ])
    );
    expect(workspace?.scenarios).toHaveLength(2);

    getAssetGraph.mockRestore();
    expect(workspace?.version.deploymentBindings).toEqual(
      versions.findDetail(fixture.versionId)?.deploymentBindings
    );
  });
});

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
     VALUES ('deployment-revision', 'deployment', 1, 'current',
       'nebula.ai-e2e.deployment-profile/1.0', ?, ?, 'valid', 'fixture', 'system', ?)`
  ).run(JSON.stringify({ environment: 'test' }), HASH_A, now);
  const version = versions.create({
    projectId: 'project-1',
    versionKey: 'release-1',
    name: 'Release 1',
    createdBy: 'system',
    requestId: 'create-version',
    deploymentRevisionId: 'deployment-revision',
  }).version;
  db.prepare(
    `INSERT INTO version_prd_documents
      (id, business_version_id, document_key, format, raw_content, content_sha256,
       parsed_json, is_current, created_at)
     VALUES ('prd-1', ?, 'main', 'markdown', '# 登录需求', ?, ?, 1, ?)`
  ).run(version.id, HASH_B, JSON.stringify({ functionalPoints: ['login.success'] }), now);
  const page = versions.createPage({
    businessVersionId: version.id,
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
  const functionalModule = versions.createFunctionalModule({
    businessVersionId: version.id,
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
  const staleScript = versions.createFunctionalScript({
    businessVersionId: version.id,
    functionalModuleId: functionalModule.id,
    scriptKey: 'login.stale',
    name: '过期登录',
    payload: functionalScriptFixture({
      scriptKey: 'login.stale',
      name: '过期登录',
      moduleId: functionalModule.id,
      pageId: page.id,
    }),
    createdBy: 'system',
    readinessStatus: 'stale',
  });
  const verifiedScript = versions.createFunctionalScript({
    businessVersionId: version.id,
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
  const staleScenario = versions.createScenario({
    businessVersionId: version.id,
    scenarioKey: 'login-stale',
    name: '过期登录流程',
    payload: scenarioPayload('login-stale', '过期登录流程'),
    createdBy: 'system',
    readinessStatus: 'stale',
  });
  const verifiedScenario = versions.createScenario({
    businessVersionId: version.id,
    scenarioKey: 'login-success',
    name: '成功登录流程',
    payload: scenarioPayload('login-success', '成功登录流程'),
    createdBy: 'system',
    readinessStatus: 'verified',
  });
  db.prepare(
    `INSERT INTO business_version_validations
      (id, business_version_id, deployment_revision_id, asset_graph_sha256,
       verification_scope_sha256, verification_scope_json, status, is_current,
       validated_at, reason_json, created_at)
     VALUES ('validation-1', ?, 'deployment-revision', ?, ?, ?, 'valid', 1, ?, ?, ?)`
  ).run(
    version.id,
    HASH_A,
    HASH_B,
    JSON.stringify({ environment: 'test' }),
    now,
    JSON.stringify({ source: 'fixture' }),
    now
  );
  return {
    versionId: version.id,
    pageId: page.id,
    businessModuleId: businessModule.id,
    functionalModuleId: functionalModule.id,
    staleScriptId: staleScript.id,
    verifiedScriptId: verifiedScript.id,
    staleScenarioId: staleScenario.id,
    verifiedScenarioId: verifiedScenario.id,
  };
}

function scenarioPayload(scenarioKey: string, name: string): Record<string, unknown> {
  return {
    schema: 'nebula.ai-e2e.scenario/1.0',
    scenarioKey,
    name,
    purpose: '验证登录',
    prdSourceRefs: [],
    actors: [],
    initialAuth: { kind: 'anonymous' },
    inputs: [],
    finalAcceptance: [],
    calls: [],
    edges: [],
    exports: [],
  };
}
