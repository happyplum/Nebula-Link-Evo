import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DatabaseSync } from 'node:sqlite';
import type {
  AssetReadinessStatus,
  AssetRevision,
  BusinessModuleAsset,
  BusinessVersion,
  BusinessVersionAssetGraph,
  BusinessVersionDetail,
  BusinessVersionValidationStatus,
  FunctionalModuleAsset,
  FunctionalScriptAsset,
  GitMetadata,
  PageAsset,
  ScenarioAsset,
} from '../../types/business-version.js';
import { collectArtifactObjectIds } from './semantic-repository-utils.js';
import { validateFunctionalScriptV1 } from '../../validation/functional-script-validator.js';

interface StatementLike {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface DatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): StatementLike;
}

type SupportedDatabase = Database.Database | DatabaseSync;
type JsonObject = Record<string, unknown>;

interface VersionRow {
  id: string;
  project_id: string;
  version_key: string;
  name: string;
  source_version_id: string | null;
  request_hash: string;
  validation_status: BusinessVersionValidationStatus;
  schema_version: number;
  git_metadata_json: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface RevisionRow {
  revision_id: string;
  revision_no: number;
  schema_id: string;
  payload_json: string;
  content_sha256: string;
  validation_status: 'pending' | 'valid' | 'invalid';
  readiness_status?: AssetReadinessStatus;
  source_asset_id: string | null;
  source_revision_id: string | null;
}

export type BusinessVersionRepositoryErrorCode = 'not_found' | 'conflict' | 'validation_failed';

export class BusinessVersionRepositoryError extends Error {
  constructor(
    readonly code: BusinessVersionRepositoryErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'BusinessVersionRepositoryError';
  }
}

export interface CreateBusinessVersionParams {
  projectId: string;
  versionKey: string;
  name: string;
  createdBy: string;
  requestId: string;
  git?: GitMetadata;
  deploymentRevisionId?: string;
}

export interface CopyBusinessVersionParams {
  sourceVersionId: string;
  versionKey: string;
  name: string;
  createdBy: string;
  copyRequestId: string;
  git?: GitMetadata;
  deploymentRevisionId?: string;
}

export interface BusinessVersionWriteResult {
  version: BusinessVersion;
  created: boolean;
}

export interface BusinessVersionCopyResult extends BusinessVersionWriteResult {
  counts: BusinessVersionDetail['assets'];
  staleAssetIds: string[];
}

interface CreateAssetParams {
  businessVersionId: string;
  payload: JsonObject;
  createdBy: string;
}

export interface CreatePageParams extends CreateAssetParams {
  pageKey: string;
}

export interface CreateBusinessModuleParams extends CreateAssetParams {
  moduleKey: string;
}

export interface CreateFunctionalModuleParams extends CreateAssetParams {
  businessModuleId: string;
  moduleKey: string;
  primaryPageDefinitionId: string;
}

export interface CreateFunctionalScriptParams extends CreateAssetParams {
  functionalModuleId: string;
  scriptKey: string;
  name: string;
  readinessStatus?: AssetReadinessStatus;
}

export interface CreateScenarioParams extends CreateAssetParams {
  scenarioKey: string;
  name: string;
  readinessStatus?: AssetReadinessStatus;
}

export class BusinessVersionRepository {
  private readonly db: DatabaseLike;

  constructor(database: SupportedDatabase) {
    this.db = database as unknown as DatabaseLike;
  }

  create(params: CreateBusinessVersionParams): BusinessVersionWriteResult {
    validateVersionWrite(params);
    this.requireProject(params.projectId);
    this.validateDeploymentRevision(params.projectId, params.deploymentRevisionId);
    const requestHash = hashValue({ kind: 'create', ...params });
    const existing = this.findByRequest('create_request_id', params.projectId, params.requestId);
    if (existing) return { version: this.assertReplay(existing, requestHash), created: false };

    return this.inImmediateTransaction(() => {
      const raced = this.findByRequest('create_request_id', params.projectId, params.requestId);
      if (raced) return { version: this.assertReplay(raced, requestHash), created: false };
      const id = randomUUID();
      const now = new Date().toISOString();
      try {
        this.db
          .prepare(
            `INSERT INTO business_versions
              (id, project_id, version_key, name, create_request_id, request_hash,
               validation_status, schema_version, git_metadata_json, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?, ?)`
          )
          .run(
            id,
            params.projectId,
            params.versionKey,
            params.name,
            params.requestId,
            requestHash,
            params.git ? stableStringify(params.git) : null,
            params.createdBy,
            now,
            now
          );
        if (params.deploymentRevisionId) {
          this.insertDefaultDeploymentBinding(id, params.deploymentRevisionId, now);
        }
      } catch (error) {
        throw translateSqliteConflict(
          error,
          'Business version key or idempotency key already exists'
        );
      }
      return { version: this.requireVersion(id), created: true };
    });
  }

  copy(params: CopyBusinessVersionParams): BusinessVersionCopyResult {
    validateCopyWrite(params);
    const source = this.requireVersion(params.sourceVersionId);
    validateGit(params.git ?? source.git);
    this.validateDeploymentRevision(source.projectId, params.deploymentRevisionId);
    const requestHash = hashValue({ kind: 'copy', projectId: source.projectId, ...params });
    const existing = this.findByRequest('copy_request_id', source.projectId, params.copyRequestId);
    if (existing) return this.existingCopyResult(this.assertReplay(existing, requestHash));

    return this.inImmediateTransaction(() => {
      const lockedSource = this.requireVersion(params.sourceVersionId);
      if (!['valid', 'archived'].includes(lockedSource.validationStatus)) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          'Only valid or archived business versions can be copied'
        );
      }
      const raced = this.findByRequest(
        'copy_request_id',
        lockedSource.projectId,
        params.copyRequestId
      );
      if (raced) return this.existingCopyResult(this.assertReplay(raced, requestHash));

      const sourceGraph = this.getAssetGraph(lockedSource.id);
      this.validateGraph(lockedSource.id, sourceGraph, true);
      const maps = createCopyMaps(sourceGraph, this.readAuxiliaryAssetIds(lockedSource.id));
      const targetId = randomUUID();
      maps.allIds.set(lockedSource.id, targetId);
      maps.sourceIds.add(lockedSource.id);
      const now = new Date().toISOString();
      try {
        this.db
          .prepare(
            `INSERT INTO business_versions
              (id, project_id, version_key, name, source_version_id, copy_request_id,
               request_hash, validation_status, schema_version, git_metadata_json,
               created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_recheck', 1, ?, ?, ?, ?)`
          )
          .run(
            targetId,
            lockedSource.projectId,
            params.versionKey,
            params.name,
            lockedSource.id,
            params.copyRequestId,
            requestHash,
            params.git
              ? stableStringify(params.git)
              : lockedSource.git
                ? stableStringify(lockedSource.git)
                : null,
            params.createdBy,
            now,
            now
          );
        this.copyDeploymentBindings(lockedSource.id, targetId, now, params.deploymentRevisionId);
        this.copyVersionDocuments(lockedSource.id, targetId, maps.allIds, now);
        this.copyVariableDefinitions(lockedSource.id, targetId, maps.allIds, now);
        this.copyGraph(targetId, sourceGraph, maps, params.createdBy, now);
        this.copySemanticAssetExtensions(lockedSource.id, targetId, maps, params.createdBy, now);
      } catch (error) {
        if (error instanceof BusinessVersionRepositoryError) throw error;
        throw translateSqliteConflict(error, 'Business version copy conflicted with existing data');
      }

      const targetGraph = this.getAssetGraph(targetId);
      this.validateGraph(targetId, targetGraph, false);
      assertNoSourceIds(targetGraph, maps.sourceIds);
      this.assertNoAuxiliarySourceIds(targetId, maps.sourceIds);
      const detail = this.requireDetail(targetId);
      return {
        version: detail,
        created: true,
        counts: detail.assets,
        staleAssetIds: collectStaleAssetIds(targetGraph),
      };
    });
  }

  findById(id: string): BusinessVersion | null {
    const row = this.db.prepare('SELECT * FROM business_versions WHERE id = ?').get(id) as
      | VersionRow
      | undefined;
    return row ? mapVersion(row) : null;
  }

  findDetail(id: string): BusinessVersionDetail | null {
    const version = this.findById(id);
    if (!version) return null;
    const graph = this.getAssetGraph(id);
    const deploymentBindings = this.db
      .prepare(
        `SELECT binding_key, deployment_revision_id, is_default
         FROM version_deployment_bindings
         WHERE business_version_id = ? ORDER BY binding_key`
      )
      .all(id) as Array<{
      binding_key: string;
      deployment_revision_id: string;
      is_default: number | bigint;
    }>;
    return {
      ...version,
      deploymentBindings: deploymentBindings.map((row) => ({
        bindingKey: row.binding_key,
        deploymentRevisionId: row.deployment_revision_id,
        isDefault: Number(row.is_default) === 1,
      })),
      assets: summarizeGraph(graph),
    };
  }

  listByProject(projectId: string): BusinessVersion[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM business_versions WHERE project_id = ? ORDER BY created_at ASC, id ASC'
        )
        .all(projectId) as VersionRow[]
    ).map(mapVersion);
  }

  setValidationStatus(id: string, status: BusinessVersionValidationStatus): BusinessVersion {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE business_versions SET validation_status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    if (Number(result.changes) === 0) this.throwNotFound('Business version', id);
    return this.requireVersion(id);
  }

  createPage(params: CreatePageParams): PageAsset {
    validateAssetInput(params, 'nebula.ai-e2e.page-definition/1.0');
    const version = this.requireMutableVersion(params.businessVersionId);
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const payloadJson = stableStringify(params.payload);
    const signature = pageSignature(params.payload);
    this.inImmediateTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO page_definitions
            (id, business_version_id, page_key, created_at) VALUES (?, ?, ?, ?)`
        )
        .run(id, version.id, requireKey(params.pageKey, 'pageKey'), now);
      this.insertRevision('page_definition_revisions', {
        id: revisionId,
        businessVersionId: version.id,
        assetColumn: 'page_definition_id',
        assetId: id,
        schemaId: String(params.payload.schema),
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy: params.createdBy,
        now,
        extraColumns: ['page_signature_sha256'],
        extraValues: [signature],
      });
      this.markAssetsChanged(version.id);
    });
    return this.requireGraphAsset(this.getAssetGraph(version.id).pages, id, 'Page');
  }

  createBusinessModule(params: CreateBusinessModuleParams): BusinessModuleAsset {
    validateAssetInput(params, 'nebula.ai-e2e.business-module/1.0');
    const version = this.requireMutableVersion(params.businessVersionId);
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const payloadJson = stableStringify(params.payload);
    this.inImmediateTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO semantic_business_modules
            (id, business_version_id, module_key, created_at) VALUES (?, ?, ?, ?)`
        )
        .run(id, version.id, requireKey(params.moduleKey, 'moduleKey'), now);
      this.insertRevision('semantic_business_module_revisions', {
        id: revisionId,
        businessVersionId: version.id,
        assetColumn: 'business_module_id',
        assetId: id,
        schemaId: String(params.payload.schema),
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy: params.createdBy,
        now,
      });
      this.markAssetsChanged(version.id);
    });
    return this.requireGraphAsset(
      this.getAssetGraph(version.id).businessModules,
      id,
      'Business module'
    );
  }

  createFunctionalModule(params: CreateFunctionalModuleParams): FunctionalModuleAsset {
    validateAssetInput(params, 'nebula.ai-e2e.functional-module/1.0');
    const version = this.requireMutableVersion(params.businessVersionId);
    this.requireOwnedAsset(
      'semantic_business_modules',
      params.businessModuleId,
      version.id,
      'Business module'
    );
    this.requireOwnedAsset('page_definitions', params.primaryPageDefinitionId, version.id, 'Page');
    if (params.payload.primaryPageDefinitionId !== params.primaryPageDefinitionId) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        'Functional module payload must reference its primary page'
      );
    }
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const payloadJson = stableStringify(params.payload);
    this.inImmediateTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO semantic_functional_modules
            (id, business_version_id, business_module_id, module_key,
             primary_page_definition_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          version.id,
          params.businessModuleId,
          requireKey(params.moduleKey, 'moduleKey'),
          params.primaryPageDefinitionId,
          now
        );
      this.insertRevision('semantic_functional_module_revisions', {
        id: revisionId,
        businessVersionId: version.id,
        assetColumn: 'functional_module_id',
        assetId: id,
        schemaId: String(params.payload.schema),
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy: params.createdBy,
        now,
      });
      this.markAssetsChanged(version.id);
    });
    return this.requireGraphAsset(
      this.getAssetGraph(version.id).functionalModules,
      id,
      'Functional module'
    );
  }

  createFunctionalScript(params: CreateFunctionalScriptParams): FunctionalScriptAsset {
    validateAssetInput(params, 'nebula.ai-e2e.functional-script/1.0');
    validateFunctionalScriptV1(params.payload);
    if (
      params.payload.moduleId !== params.functionalModuleId ||
      params.payload.scriptKey !== params.scriptKey ||
      params.payload.name !== params.name
    ) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        'Functional script identity fields must match its asset identity'
      );
    }
    const version = this.requireMutableVersion(params.businessVersionId);
    this.requireOwnedAsset(
      'semantic_functional_modules',
      params.functionalModuleId,
      version.id,
      'Functional module'
    );
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const payloadJson = stableStringify(params.payload);
    this.inImmediateTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO functional_scripts
            (id, business_version_id, functional_module_id, script_key, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          version.id,
          params.functionalModuleId,
          requireKey(params.scriptKey, 'scriptKey'),
          requireText(params.name, 'name'),
          now
        );
      this.insertRevision('functional_script_revisions', {
        id: revisionId,
        businessVersionId: version.id,
        assetColumn: 'functional_script_id',
        assetId: id,
        schemaId: String(params.payload.schema),
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy: params.createdBy,
        now,
        extraColumns: ['readiness_status', 'change_kind'],
        extraValues: [params.readinessStatus ?? 'unverified', 'generated'],
      });
      this.markAssetsChanged(version.id);
    });
    return this.requireGraphAsset(
      this.getAssetGraph(version.id).functionalScripts,
      id,
      'Functional script'
    );
  }

  createScenario(params: CreateScenarioParams): ScenarioAsset {
    validateAssetInput(params, 'nebula.ai-e2e.scenario/1.0');
    const version = this.requireMutableVersion(params.businessVersionId);
    validateScenarioPayload(
      params.payload,
      new Set(this.getAssetGraph(version.id).functionalScripts.map((item) => item.id))
    );
    const id = randomUUID();
    const revisionId = randomUUID();
    const now = new Date().toISOString();
    const payloadJson = stableStringify(params.payload);
    this.inImmediateTransaction(() => {
      this.db
        .prepare(
          `INSERT INTO semantic_test_scenarios
            (id, business_version_id, scenario_key, name, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          id,
          version.id,
          requireKey(params.scenarioKey, 'scenarioKey'),
          requireText(params.name, 'name'),
          now
        );
      this.insertRevision('semantic_test_scenario_revisions', {
        id: revisionId,
        businessVersionId: version.id,
        assetColumn: 'test_scenario_id',
        assetId: id,
        schemaId: String(params.payload.schema),
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy: params.createdBy,
        now,
        extraColumns: ['readiness_status'],
        extraValues: [params.readinessStatus ?? 'unverified'],
      });
      this.markAssetsChanged(version.id);
    });
    return this.requireGraphAsset(this.getAssetGraph(version.id).scenarios, id, 'Scenario');
  }

  getAssetGraph(businessVersionId: string): BusinessVersionAssetGraph {
    return {
      pages: this.readPages(businessVersionId),
      businessModules: this.readBusinessModules(businessVersionId),
      functionalModules: this.readFunctionalModules(businessVersionId),
      functionalScripts: this.readFunctionalScripts(businessVersionId),
      scenarios: this.readScenarios(businessVersionId),
    };
  }

  private copyGraph(
    targetVersionId: string,
    graph: BusinessVersionAssetGraph,
    maps: CopyMaps,
    createdBy: string,
    now: string
  ): void {
    for (const source of graph.pages) {
      const id = requireMapped(maps.stableIds, source.id);
      const revisionId = requireMapped(maps.revisionIds, source.currentRevision.id);
      const payload = rewriteIds(source.currentRevision.payload, maps.allIds) as JsonObject;
      const payloadJson = stableStringify(payload);
      this.db
        .prepare(
          'INSERT INTO page_definitions (id, business_version_id, page_key, created_at) VALUES (?, ?, ?, ?)'
        )
        .run(id, targetVersionId, source.pageKey, now);
      this.insertRevision('page_definition_revisions', {
        id: revisionId,
        businessVersionId: targetVersionId,
        assetColumn: 'page_definition_id',
        assetId: id,
        schemaId: source.currentRevision.schemaId,
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy,
        now,
        sourceAssetId: source.id,
        sourceRevisionId: source.currentRevision.id,
        changeReason: 'business_version_copy',
        extraColumns: ['page_signature_sha256'],
        extraValues: [pageSignature(payload)],
      });
    }
    for (const source of graph.businessModules) {
      const id = requireMapped(maps.stableIds, source.id);
      const revisionId = requireMapped(maps.revisionIds, source.currentRevision.id);
      const payload = rewriteIds(source.currentRevision.payload, maps.allIds);
      const payloadJson = stableStringify(payload);
      this.db
        .prepare(
          `INSERT INTO semantic_business_modules
            (id, business_version_id, module_key, created_at) VALUES (?, ?, ?, ?)`
        )
        .run(id, targetVersionId, source.moduleKey, now);
      this.insertRevision('semantic_business_module_revisions', {
        id: revisionId,
        businessVersionId: targetVersionId,
        assetColumn: 'business_module_id',
        assetId: id,
        schemaId: source.currentRevision.schemaId,
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy,
        now,
        sourceAssetId: source.id,
        sourceRevisionId: source.currentRevision.id,
        changeReason: 'business_version_copy',
      });
    }
    for (const source of graph.functionalModules) {
      const id = requireMapped(maps.stableIds, source.id);
      const revisionId = requireMapped(maps.revisionIds, source.currentRevision.id);
      const payload = rewriteIds(source.currentRevision.payload, maps.allIds);
      const payloadJson = stableStringify(payload);
      this.db
        .prepare(
          `INSERT INTO semantic_functional_modules
            (id, business_version_id, business_module_id, module_key,
             primary_page_definition_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          targetVersionId,
          requireMapped(maps.stableIds, source.businessModuleId),
          source.moduleKey,
          requireMapped(maps.stableIds, source.primaryPageDefinitionId),
          now
        );
      this.insertRevision('semantic_functional_module_revisions', {
        id: revisionId,
        businessVersionId: targetVersionId,
        assetColumn: 'functional_module_id',
        assetId: id,
        schemaId: source.currentRevision.schemaId,
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy,
        now,
        sourceAssetId: source.id,
        sourceRevisionId: source.currentRevision.id,
        changeReason: 'business_version_copy',
      });
    }
    for (const source of graph.functionalScripts) {
      const id = requireMapped(maps.stableIds, source.id);
      const revisionId = requireMapped(maps.revisionIds, source.currentRevision.id);
      const payload = rewriteIds(source.currentRevision.payload, maps.allIds);
      const payloadJson = stableStringify(payload);
      this.db
        .prepare(
          `INSERT INTO functional_scripts
            (id, business_version_id, functional_module_id, script_key, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          targetVersionId,
          requireMapped(maps.stableIds, source.functionalModuleId),
          source.scriptKey,
          source.name,
          now
        );
      this.insertRevision('functional_script_revisions', {
        id: revisionId,
        businessVersionId: targetVersionId,
        assetColumn: 'functional_script_id',
        assetId: id,
        schemaId: source.currentRevision.schemaId,
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy,
        now,
        sourceAssetId: source.id,
        sourceRevisionId: source.currentRevision.id,
        changeReason: 'business_version_copy',
        extraColumns: ['readiness_status', 'change_kind'],
        extraValues: ['stale', 'copy'],
      });
    }
    for (const source of graph.scenarios) {
      const id = requireMapped(maps.stableIds, source.id);
      const revisionId = requireMapped(maps.revisionIds, source.currentRevision.id);
      const payload = rewriteIds(source.currentRevision.payload, maps.allIds);
      const payloadJson = stableStringify(payload);
      this.db
        .prepare(
          `INSERT INTO semantic_test_scenarios
            (id, business_version_id, scenario_key, name, created_at) VALUES (?, ?, ?, ?, ?)`
        )
        .run(id, targetVersionId, source.scenarioKey, source.name, now);
      this.insertRevision('semantic_test_scenario_revisions', {
        id: revisionId,
        businessVersionId: targetVersionId,
        assetColumn: 'test_scenario_id',
        assetId: id,
        schemaId: source.currentRevision.schemaId,
        payloadJson,
        contentSha256: sha256(payloadJson),
        createdBy,
        now,
        sourceAssetId: source.id,
        sourceRevisionId: source.currentRevision.id,
        changeReason: 'business_version_copy',
        extraColumns: ['readiness_status'],
        extraValues: ['stale'],
      });
    }
  }

  private copyDeploymentBindings(
    sourceVersionId: string,
    targetVersionId: string,
    now: string,
    overrideRevisionId?: string
  ): void {
    if (overrideRevisionId) {
      this.insertDefaultDeploymentBinding(targetVersionId, overrideRevisionId, now);
      return;
    }
    const rows = this.db
      .prepare(
        `SELECT deployment_revision_id, binding_key, is_default
         FROM version_deployment_bindings WHERE business_version_id = ?`
      )
      .all(sourceVersionId) as Array<{
      deployment_revision_id: string;
      binding_key: string;
      is_default: number | bigint;
    }>;
    const insert = this.db.prepare(
      `INSERT INTO version_deployment_bindings
        (business_version_id, deployment_revision_id, binding_key, is_default, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      insert.run(
        targetVersionId,
        row.deployment_revision_id,
        row.binding_key,
        Number(row.is_default),
        now
      );
    }
  }

  private copyVersionDocuments(
    sourceVersionId: string,
    targetVersionId: string,
    idMap: ReadonlyMap<string, string>,
    now: string
  ): void {
    const rows = this.db
      .prepare(
        `SELECT * FROM version_prd_documents
         WHERE business_version_id = ? AND is_current = 1 ORDER BY document_key`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insert = this.db.prepare(
      `INSERT INTO version_prd_documents
        (id, business_version_id, document_key, format, raw_content, content_sha256,
         parsed_json, source_uri, is_current, source_document_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    for (const row of rows) {
      const parsed = row.parsed_json
        ? stableStringify(rewriteIds(JSON.parse(String(row.parsed_json)) as unknown, idMap))
        : null;
      insert.run(
        requireMapped(idMap, String(row.id)),
        targetVersionId,
        row.document_key,
        row.format,
        row.raw_content,
        row.content_sha256,
        parsed,
        row.source_uri,
        row.id,
        now
      );
    }
  }

  private copyVariableDefinitions(
    sourceVersionId: string,
    targetVersionId: string,
    idMap: ReadonlyMap<string, string>,
    now: string
  ): void {
    const rows = this.db
      .prepare(
        'SELECT * FROM version_variable_definitions WHERE business_version_id = ? ORDER BY name'
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insert = this.db.prepare(
      `INSERT INTO version_variable_definitions
        (id, business_version_id, name, type, sensitivity, constraints_json,
         default_json, secret_ref, source_variable_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of rows) {
      const constraints = row.constraints_json
        ? stableStringify(rewriteIds(JSON.parse(String(row.constraints_json)) as unknown, idMap))
        : null;
      const defaultValue = row.default_json
        ? stableStringify(rewriteIds(JSON.parse(String(row.default_json)) as unknown, idMap))
        : null;
      insert.run(
        requireMapped(idMap, String(row.id)),
        targetVersionId,
        row.name,
        row.type,
        row.sensitivity,
        constraints,
        defaultValue,
        row.secret_ref,
        row.id,
        now
      );
    }
  }

  private copySemanticAssetExtensions(
    sourceVersionId: string,
    targetVersionId: string,
    maps: CopyMaps,
    createdBy: string,
    now: string
  ): void {
    const decisions = this.db
      .prepare(
        `SELECT * FROM version_decisions
         WHERE business_version_id = ? AND status = 'active' ORDER BY decision_key`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insertDecision = this.db.prepare(
      `INSERT INTO version_decisions
        (id, business_version_id, decision_key, status, question, category, answer, reason,
         evidence_refs_json, supersedes_decision_id, decided_by_type, decided_by_id, created_at)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
    );
    for (const row of decisions) {
      insertDecision.run(
        requireMapped(maps.allIds, String(row.id)),
        targetVersionId,
        row.decision_key,
        row.question,
        row.category,
        row.answer,
        row.reason,
        stableStringify(
          rewriteIds(JSON.parse(String(row.evidence_refs_json)) as unknown, maps.allIds)
        ),
        row.decided_by_type,
        row.decided_by_id,
        now
      );
    }

    const baselineRevisions = this.db
      .prepare(
        `SELECT v.id AS variant_id, v.page_definition_id, v.variant_key, r.*
         FROM page_baseline_variants v
         JOIN page_baseline_revisions r
           ON r.page_baseline_variant_id = v.id AND r.lifecycle = 'current'
         WHERE v.business_version_id = ? AND v.archived_at IS NULL
         ORDER BY v.variant_key`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insertBaselineVariant = this.db.prepare(
      `INSERT INTO page_baseline_variants
        (id, business_version_id, page_definition_id, variant_key, created_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const insertBaselineRevision = this.db.prepare(
      `INSERT INTO page_baseline_revisions
        (id, business_version_id, page_baseline_variant_id, revision_no, lifecycle, schema_id,
         payload_json, content_sha256, validation_status, supersedes_revision_id,
         source_asset_id, source_revision_id, change_reason, created_by_type, created_by_id,
         created_at, validated_at)
       VALUES (?, ?, ?, 1, 'current', ?, ?, ?, 'valid', NULL, ?, ?,
         'business_version_copy', ?, ?, ?, ?)`
    );
    for (const row of baselineRevisions) {
      const variantId = requireMapped(maps.allIds, String(row.variant_id));
      const revisionId = requireMapped(maps.allIds, String(row.id));
      const payloadJson = stableStringify(
        rewriteIds(JSON.parse(String(row.payload_json)) as unknown, maps.allIds)
      );
      insertBaselineVariant.run(
        variantId,
        targetVersionId,
        requireMapped(maps.allIds, String(row.page_definition_id)),
        row.variant_key,
        now
      );
      insertBaselineRevision.run(
        revisionId,
        targetVersionId,
        variantId,
        row.schema_id,
        payloadJson,
        sha256(payloadJson),
        row.variant_id,
        row.id,
        actorType(createdBy),
        createdBy,
        now,
        now
      );
      const incrementArtifact = this.db.prepare(
        `UPDATE artifact_objects SET ref_count = ref_count + 1
         WHERE id = ? AND deleted_at IS NULL`
      );
      for (const artifactId of collectArtifactObjectIds(JSON.parse(payloadJson) as unknown)) {
        const result = incrementArtifact.run(artifactId);
        if (Number(result.changes) !== 1) {
          throw new BusinessVersionRepositoryError(
            'validation_failed',
            `Baseline artifact is unavailable: ${artifactId}`
          );
        }
      }
    }

    const requirementRevisions = this.db
      .prepare(
        `SELECT * FROM module_requirement_revisions
         WHERE business_version_id = ? AND lifecycle = 'current'
         ORDER BY functional_module_id`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insertRequirementRevision = this.db.prepare(
      `INSERT INTO module_requirement_revisions
        (id, business_version_id, functional_module_id, revision_no, lifecycle, schema_id,
         payload_json, content_sha256, validation_status, supersedes_revision_id,
         source_asset_id, source_revision_id, change_reason, created_by_type, created_by_id,
         created_at, validated_at)
       VALUES (?, ?, ?, 1, 'current', ?, ?, ?, 'valid', NULL, ?, ?,
         'business_version_copy', ?, ?, ?, ?)`
    );
    for (const row of requirementRevisions) {
      const payloadJson = stableStringify(
        rewriteIds(JSON.parse(String(row.payload_json)) as unknown, maps.allIds)
      );
      insertRequirementRevision.run(
        requireMapped(maps.allIds, String(row.id)),
        targetVersionId,
        requireMapped(maps.allIds, String(row.functional_module_id)),
        row.schema_id,
        payloadJson,
        sha256(payloadJson),
        row.functional_module_id,
        row.id,
        actorType(createdBy),
        createdBy,
        now,
        now
      );
    }

    const coverageRows = this.db
      .prepare(
        `SELECT * FROM functional_point_coverage
         WHERE business_version_id = ? AND lifecycle = 'current'
         ORDER BY module_requirement_revision_id, functional_point_key`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insertCoverage = this.db.prepare(
      `INSERT INTO functional_point_coverage
        (id, business_version_id, functional_module_id, module_requirement_revision_id,
         functional_point_key, required, disposition, functional_script_id,
         functional_script_revision_id, decision_id, lifecycle, source_authoring_job_id,
         reason_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'current', NULL, ?, ?)`
    );
    for (const row of coverageRows) {
      insertCoverage.run(
        requireMapped(maps.allIds, String(row.id)),
        targetVersionId,
        requireMapped(maps.allIds, String(row.functional_module_id)),
        requireMapped(maps.allIds, String(row.module_requirement_revision_id)),
        row.functional_point_key,
        row.required,
        row.disposition,
        row.functional_script_id
          ? requireMapped(maps.allIds, String(row.functional_script_id))
          : null,
        row.functional_script_revision_id
          ? requireMapped(maps.allIds, String(row.functional_script_revision_id))
          : null,
        row.decision_id ? requireMapped(maps.allIds, String(row.decision_id)) : null,
        stableStringify(rewriteIds(JSON.parse(String(row.reason_json)) as unknown, maps.allIds)),
        now
      );
    }

    const dependencies = this.db
      .prepare(
        `SELECT * FROM asset_revision_dependencies
         WHERE business_version_id = ? ORDER BY from_revision_id, source_pointer`
      )
      .all(sourceVersionId) as Array<Record<string, unknown>>;
    const insertDependency = this.db.prepare(
      `INSERT INTO asset_revision_dependencies
        (id, business_version_id, from_asset_type, from_asset_id, from_revision_id,
         to_asset_type, to_asset_id, to_revision_id, relation, source_pointer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const row of dependencies) {
      const fromRevisionId = maps.allIds.get(String(row.from_revision_id));
      const fromAssetId = maps.allIds.get(String(row.from_asset_id));
      const toAssetId = maps.allIds.get(String(row.to_asset_id));
      if (!fromRevisionId || !fromAssetId || !toAssetId) continue;
      insertDependency.run(
        requireMapped(maps.allIds, String(row.id)),
        targetVersionId,
        row.from_asset_type,
        fromAssetId,
        fromRevisionId,
        row.to_asset_type,
        toAssetId,
        row.to_revision_id ? (maps.allIds.get(String(row.to_revision_id)) ?? null) : null,
        row.relation,
        row.source_pointer,
        now
      );
    }
  }

  private insertRevision(
    table: string,
    input: {
      id: string;
      businessVersionId: string;
      assetColumn: string;
      assetId: string;
      schemaId: string;
      payloadJson: string;
      contentSha256: string;
      createdBy: string;
      now: string;
      sourceAssetId?: string;
      sourceRevisionId?: string;
      changeReason?: string;
      extraColumns?: string[];
      extraValues?: unknown[];
    }
  ): void {
    const extraColumns = input.extraColumns ?? [];
    const columns = [
      'id',
      'business_version_id',
      input.assetColumn,
      'revision_no',
      'lifecycle',
      'schema_id',
      'payload_json',
      'content_sha256',
      'validation_status',
      'source_asset_id',
      'source_revision_id',
      'change_reason',
      'created_by_type',
      'created_by_id',
      'created_at',
      'validated_at',
      ...extraColumns,
    ];
    const values: unknown[] = [
      input.id,
      input.businessVersionId,
      input.assetId,
      1,
      'current',
      input.schemaId,
      input.payloadJson,
      input.contentSha256,
      'valid',
      input.sourceAssetId ?? null,
      input.sourceRevisionId ?? null,
      input.changeReason ?? 'initial_create',
      input.createdBy === 'system' ? 'system' : 'user',
      input.createdBy,
      input.now,
      input.now,
      ...(input.extraValues ?? []),
    ];
    this.db
      .prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
      )
      .run(...values);
  }

  private readPages(versionId: string): PageAsset[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.page_key, r.id AS revision_id, r.revision_no, r.schema_id,
                r.payload_json, r.content_sha256, r.validation_status,
                r.source_asset_id, r.source_revision_id
         FROM page_definitions p
         JOIN page_definition_revisions r ON r.page_definition_id = p.id AND r.lifecycle = 'current'
         WHERE p.business_version_id = ? AND p.archived_at IS NULL ORDER BY p.page_key`
      )
      .all(versionId) as Array<RevisionRow & { id: string; page_key: string }>;
    return rows.map((row) => ({
      id: row.id,
      pageKey: row.page_key,
      currentRevision: mapRevision(row),
    }));
  }

  private readBusinessModules(versionId: string): BusinessModuleAsset[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.module_key, r.id AS revision_id, r.revision_no, r.schema_id,
                r.payload_json, r.content_sha256, r.validation_status,
                r.source_asset_id, r.source_revision_id
         FROM semantic_business_modules m
         JOIN semantic_business_module_revisions r
           ON r.business_module_id = m.id AND r.lifecycle = 'current'
         WHERE m.business_version_id = ? AND m.archived_at IS NULL ORDER BY m.module_key`
      )
      .all(versionId) as Array<RevisionRow & { id: string; module_key: string }>;
    return rows.map((row) => ({
      id: row.id,
      moduleKey: row.module_key,
      currentRevision: mapRevision(row),
    }));
  }

  private readFunctionalModules(versionId: string): FunctionalModuleAsset[] {
    const rows = this.db
      .prepare(
        `SELECT m.id, m.business_module_id, m.module_key, m.primary_page_definition_id,
                r.id AS revision_id, r.revision_no, r.schema_id, r.payload_json,
                r.content_sha256, r.validation_status, r.source_asset_id, r.source_revision_id
         FROM semantic_functional_modules m
         JOIN semantic_functional_module_revisions r
           ON r.functional_module_id = m.id AND r.lifecycle = 'current'
         WHERE m.business_version_id = ? AND m.archived_at IS NULL ORDER BY m.module_key`
      )
      .all(versionId) as Array<
      RevisionRow & {
        id: string;
        business_module_id: string;
        module_key: string;
        primary_page_definition_id: string;
      }
    >;
    return rows.map((row) => ({
      id: row.id,
      businessModuleId: row.business_module_id,
      moduleKey: row.module_key,
      primaryPageDefinitionId: row.primary_page_definition_id,
      currentRevision: mapRevision(row),
    }));
  }

  private readFunctionalScripts(versionId: string): FunctionalScriptAsset[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.functional_module_id, s.script_key, s.name,
                r.id AS revision_id, r.revision_no, r.schema_id, r.payload_json,
                r.content_sha256, r.validation_status, r.readiness_status,
                r.source_asset_id, r.source_revision_id
         FROM functional_scripts s
         JOIN functional_script_revisions r
           ON r.functional_script_id = s.id AND r.lifecycle = 'current'
         WHERE s.business_version_id = ? AND s.archived_at IS NULL ORDER BY s.script_key`
      )
      .all(versionId) as Array<
      RevisionRow & {
        id: string;
        functional_module_id: string;
        script_key: string;
        name: string;
      }
    >;
    return rows.map((row) => ({
      id: row.id,
      functionalModuleId: row.functional_module_id,
      scriptKey: row.script_key,
      name: row.name,
      currentRevision: mapRevision(row),
    }));
  }

  private readScenarios(versionId: string): ScenarioAsset[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.scenario_key, s.name, r.id AS revision_id, r.revision_no,
                r.schema_id, r.payload_json, r.content_sha256, r.validation_status,
                r.readiness_status, r.source_asset_id, r.source_revision_id
         FROM semantic_test_scenarios s
         JOIN semantic_test_scenario_revisions r
           ON r.test_scenario_id = s.id AND r.lifecycle = 'current'
         WHERE s.business_version_id = ? AND s.archived_at IS NULL ORDER BY s.scenario_key`
      )
      .all(versionId) as Array<RevisionRow & { id: string; scenario_key: string; name: string }>;
    return rows.map((row) => ({
      id: row.id,
      scenarioKey: row.scenario_key,
      name: row.name,
      currentRevision: mapRevision(row),
    }));
  }

  private validateGraph(
    versionId: string,
    graph: BusinessVersionAssetGraph,
    requireVerifiedExecutables: boolean
  ): void {
    const stableCounts = {
      pages: this.count('page_definitions', versionId),
      businessModules: this.count('semantic_business_modules', versionId),
      functionalModules: this.count('semantic_functional_modules', versionId),
      functionalScripts: this.count('functional_scripts', versionId),
      scenarios: this.count('semantic_test_scenarios', versionId),
    };
    for (const [kind, count] of Object.entries(stableCounts)) {
      if (graph[kind as keyof BusinessVersionAssetGraph].length !== count) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Business version has ${kind} without a current revision`
        );
      }
    }
    const pageIds = new Set(graph.pages.map((item) => item.id));
    const businessModuleIds = new Set(graph.businessModules.map((item) => item.id));
    const functionalModuleIds = new Set(graph.functionalModules.map((item) => item.id));
    const scriptIds = new Set(graph.functionalScripts.map((item) => item.id));
    for (const item of [
      ...graph.pages,
      ...graph.businessModules,
      ...graph.functionalModules,
      ...graph.functionalScripts,
      ...graph.scenarios,
    ]) {
      if (item.currentRevision.validationStatus !== 'valid') {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Asset ${item.id} does not have a valid current revision`
        );
      }
      const payloadJson = stableStringify(item.currentRevision.payload);
      if (sha256(payloadJson) !== item.currentRevision.contentSha256) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Asset ${item.id} content hash does not match its payload`
        );
      }
    }
    for (const page of graph.pages) {
      const transitions = page.currentRevision.payload.allowedTransitionPageIds;
      if (
        Array.isArray(transitions) &&
        transitions.some((id) => typeof id !== 'string' || !pageIds.has(id))
      ) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Page ${page.pageKey} contains an invalid transition reference`
        );
      }
    }
    for (const module of graph.functionalModules) {
      if (
        !businessModuleIds.has(module.businessModuleId) ||
        !pageIds.has(module.primaryPageDefinitionId)
      ) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Functional module ${module.moduleKey} contains a cross-version or missing reference`
        );
      }
    }
    for (const script of graph.functionalScripts) {
      if (!functionalModuleIds.has(script.functionalModuleId)) {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Functional script ${script.scriptKey} references a missing module`
        );
      }
      if (requireVerifiedExecutables && script.currentRevision.readinessStatus !== 'verified') {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Functional script ${script.scriptKey} is not verified`
        );
      }
    }
    for (const scenario of graph.scenarios) {
      validateScenarioPayload(scenario.currentRevision.payload, scriptIds);
      if (requireVerifiedExecutables && scenario.currentRevision.readinessStatus !== 'verified') {
        throw new BusinessVersionRepositoryError(
          'validation_failed',
          `Scenario ${scenario.scenarioKey} is not verified`
        );
      }
    }
  }

  private count(table: string, versionId: string): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE business_version_id = ?`)
      .get(versionId) as { count: number | bigint };
    return Number(row.count);
  }

  private readAuxiliaryAssetIds(versionId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM version_prd_documents
           WHERE business_version_id = ? AND is_current = 1
         UNION ALL
         SELECT id FROM version_variable_definitions WHERE business_version_id = ?
         UNION ALL
         SELECT id FROM version_decisions WHERE business_version_id = ? AND status = 'active'
         UNION ALL
         SELECT id FROM page_baseline_variants
           WHERE business_version_id = ? AND archived_at IS NULL
         UNION ALL
         SELECT id FROM page_baseline_revisions
           WHERE business_version_id = ? AND lifecycle = 'current'
         UNION ALL
         SELECT id FROM module_requirement_revisions
           WHERE business_version_id = ? AND lifecycle = 'current'
         UNION ALL
         SELECT id FROM functional_point_coverage
           WHERE business_version_id = ? AND lifecycle = 'current'
         UNION ALL
         SELECT id FROM asset_revision_dependencies WHERE business_version_id = ?`
      )
      .all(
        versionId,
        versionId,
        versionId,
        versionId,
        versionId,
        versionId,
        versionId,
        versionId
      ) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  private assertNoAuxiliarySourceIds(versionId: string, sourceIds: ReadonlySet<string>): void {
    const documents = this.db
      .prepare(
        `SELECT parsed_json FROM version_prd_documents
         WHERE business_version_id = ? AND is_current = 1`
      )
      .all(versionId) as Array<{ parsed_json: string | null }>;
    const variables = this.db
      .prepare(
        `SELECT constraints_json, default_json FROM version_variable_definitions
         WHERE business_version_id = ?`
      )
      .all(versionId) as Array<{ constraints_json: string | null; default_json: string | null }>;
    const values = [
      ...documents.map((row) => row.parsed_json),
      ...variables.flatMap((row) => [row.constraints_json, row.default_json]),
      ...(
        this.db
          .prepare(
            `SELECT evidence_refs_json AS value FROM version_decisions
             WHERE business_version_id = ? AND status = 'active'
           UNION ALL
           SELECT payload_json AS value FROM page_baseline_revisions
             WHERE business_version_id = ? AND lifecycle = 'current'
           UNION ALL
           SELECT payload_json AS value FROM module_requirement_revisions
             WHERE business_version_id = ? AND lifecycle = 'current'
           UNION ALL
           SELECT reason_json AS value FROM functional_point_coverage
             WHERE business_version_id = ? AND lifecycle = 'current'`
          )
          .all(versionId, versionId, versionId, versionId) as Array<{ value: string }>
      ).map((row) => row.value),
    ]
      .filter((value): value is string => value !== null)
      .map((value) => JSON.parse(value) as unknown);
    if (values.some((value) => containsSourceId(value, sourceIds))) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        'Copied version metadata still references mutable source assets'
      );
    }
  }

  private requireOwnedAsset(table: string, id: string, versionId: string, label: string): void {
    const row = this.db
      .prepare(`SELECT id FROM ${table} WHERE id = ? AND business_version_id = ?`)
      .get(id, versionId);
    if (!row) this.throwNotFound(label, id);
  }

  private requireProject(projectId: string): void {
    if (!this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) {
      this.throwNotFound('Project', projectId);
    }
  }

  private validateDeploymentRevision(projectId: string, revisionId?: string): void {
    if (!revisionId) return;
    const row = this.db
      .prepare(
        `SELECT r.id FROM deployment_profile_revisions r
         JOIN deployment_profiles p ON p.id = r.deployment_profile_id
         WHERE r.id = ? AND p.project_id = ? AND r.lifecycle = 'current'
           AND r.validation_status = 'valid'`
      )
      .get(revisionId, projectId);
    if (!row) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        'deploymentRevisionId must reference a current valid revision in the same project'
      );
    }
  }

  private insertDefaultDeploymentBinding(
    versionId: string,
    deploymentRevisionId: string,
    now: string
  ): void {
    this.db
      .prepare(
        `INSERT INTO version_deployment_bindings
          (business_version_id, deployment_revision_id, binding_key, is_default, created_at)
         VALUES (?, ?, 'default', 1, ?)`
      )
      .run(versionId, deploymentRevisionId, now);
  }

  private findByRequest(
    column: 'create_request_id' | 'copy_request_id',
    projectId: string,
    requestId: string
  ): VersionRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM business_versions WHERE project_id = ? AND ${column} = ?`)
        .get(projectId, requestId) as VersionRow | undefined) ?? null
    );
  }

  private assertReplay(row: VersionRow, requestHash: string): BusinessVersion {
    if (row.request_hash !== requestHash) {
      throw new BusinessVersionRepositoryError(
        'conflict',
        'Idempotency key was reused with a different request'
      );
    }
    return mapVersion(row);
  }

  private existingCopyResult(version: BusinessVersion): BusinessVersionCopyResult {
    const detail = this.requireDetail(version.id);
    const graph = this.getAssetGraph(version.id);
    return {
      version: detail,
      created: false,
      counts: detail.assets,
      staleAssetIds: collectStaleAssetIds(graph),
    };
  }

  private requireVersion(id: string): BusinessVersion {
    const version = this.findById(id);
    if (!version) this.throwNotFound('Business version', id);
    return version;
  }

  private requireDetail(id: string): BusinessVersionDetail {
    const detail = this.findDetail(id);
    if (!detail) this.throwNotFound('Business version', id);
    return detail;
  }

  private requireMutableVersion(id: string): BusinessVersion {
    const version = this.requireVersion(id);
    if (version.validationStatus === 'archived') {
      throw new BusinessVersionRepositoryError(
        'conflict',
        'Archived business versions are read-only'
      );
    }
    return version;
  }

  private requireGraphAsset<T extends { id: string }>(items: T[], id: string, label: string): T {
    const item = items.find((entry) => entry.id === id);
    if (!item)
      throw new BusinessVersionRepositoryError('not_found', `${label} ${id} was not found`);
    return item;
  }

  private markAssetsChanged(versionId: string): void {
    this.db
      .prepare(
        `UPDATE business_versions
         SET validation_status = CASE WHEN validation_status = 'draft' THEN 'draft' ELSE 'needs_recheck' END,
             updated_at = ? WHERE id = ?`
      )
      .run(new Date().toISOString(), versionId);
  }

  private throwNotFound(label: string, id: string): never {
    throw new BusinessVersionRepositoryError('not_found', `${label} ${id} was not found`);
  }

  private inImmediateTransaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The original failure remains authoritative.
      }
      throw error;
    }
  }
}

interface CopyMaps {
  stableIds: Map<string, string>;
  revisionIds: Map<string, string>;
  allIds: Map<string, string>;
  sourceIds: Set<string>;
}

function createCopyMaps(
  graph: BusinessVersionAssetGraph,
  auxiliaryAssetIds: readonly string[]
): CopyMaps {
  const stableIds = new Map<string, string>();
  const revisionIds = new Map<string, string>();
  for (const asset of [
    ...graph.pages,
    ...graph.businessModules,
    ...graph.functionalModules,
    ...graph.functionalScripts,
    ...graph.scenarios,
  ]) {
    stableIds.set(asset.id, randomUUID());
    revisionIds.set(asset.currentRevision.id, randomUUID());
  }
  for (const id of auxiliaryAssetIds) stableIds.set(id, randomUUID());
  return {
    stableIds,
    revisionIds,
    allIds: new Map([...stableIds, ...revisionIds]),
    sourceIds: new Set([...stableIds.keys(), ...revisionIds.keys()]),
  };
}

function mapVersion(row: VersionRow): BusinessVersion {
  return {
    id: row.id,
    projectId: row.project_id,
    versionKey: row.version_key,
    name: row.name,
    ...(row.source_version_id ? { sourceVersionId: row.source_version_id } : {}),
    validationStatus: row.validation_status,
    schemaVersion: 1,
    ...(row.git_metadata_json ? { git: JSON.parse(row.git_metadata_json) as GitMetadata } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
  };
}

function mapRevision(row: RevisionRow): AssetRevision {
  return {
    id: row.revision_id,
    revisionNo: Number(row.revision_no),
    schemaId: row.schema_id,
    payload: JSON.parse(row.payload_json) as JsonObject,
    contentSha256: row.content_sha256,
    validationStatus: row.validation_status,
    ...(row.readiness_status ? { readinessStatus: row.readiness_status } : {}),
    ...(row.source_asset_id ? { sourceAssetId: row.source_asset_id } : {}),
    ...(row.source_revision_id ? { sourceRevisionId: row.source_revision_id } : {}),
  };
}

function summarizeGraph(graph: BusinessVersionAssetGraph): BusinessVersionDetail['assets'] {
  return {
    pages: graph.pages.length,
    businessModules: graph.businessModules.length,
    functionalModules: graph.functionalModules.length,
    functionalScripts: graph.functionalScripts.length,
    scenarios: graph.scenarios.length,
    staleExecutableAssets: collectStaleAssetIds(graph).length,
  };
}

function collectStaleAssetIds(graph: BusinessVersionAssetGraph): string[] {
  return [...graph.functionalScripts, ...graph.scenarios]
    .filter((asset) => asset.currentRevision.readinessStatus === 'stale')
    .map((asset) => asset.id);
}

function actorType(createdBy: string): 'system' | 'user' {
  return createdBy === 'system' ? 'system' : 'user';
}

function validateVersionWrite(params: CreateBusinessVersionParams): void {
  requireKey(params.versionKey, 'versionKey');
  requireText(params.name, 'name');
  requireText(params.createdBy, 'createdBy');
  requireRequestId(params.requestId);
  validateGit(params.git);
}

function validateCopyWrite(params: CopyBusinessVersionParams): void {
  requireText(params.sourceVersionId, 'sourceVersionId');
  requireKey(params.versionKey, 'versionKey');
  requireText(params.name, 'name');
  requireText(params.createdBy, 'createdBy');
  requireRequestId(params.copyRequestId);
  validateGit(params.git);
}

function validateGit(git?: GitMetadata): void {
  if (!git) return;
  const allowed = new Set(['repository', 'ref', 'commit', 'buildId']);
  for (const [key, value] of Object.entries(git)) {
    if (!allowed.has(key) || typeof value !== 'string' || value.length > 500) {
      throw new BusinessVersionRepositoryError('validation_failed', 'git metadata is invalid');
    }
  }
  if (
    git.repository &&
    (/:\/\/[^/@\s]+:[^/@\s]+@/.test(git.repository) ||
      /[?&](?:access[_-]?token|api[_-]?key|password|secret)=/i.test(git.repository))
  ) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'git repository must not contain inline credentials'
    );
  }
}

function validateAssetInput(params: CreateAssetParams, schema: string): void {
  requireText(params.businessVersionId, 'businessVersionId');
  requireText(params.createdBy, 'createdBy');
  if (params.payload.schema !== schema) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      `Asset payload schema must be ${schema}`
    );
  }
  assertNoInlineSecrets(params.payload, 'payload');
}

function validateScenarioPayload(payload: JsonObject, scriptIds: ReadonlySet<string>): void {
  const calls = payload.calls;
  const edges = payload.edges;
  if (!Array.isArray(calls) || !Array.isArray(edges)) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'Scenario payload must contain calls and edges arrays'
    );
  }
  const callKeys = new Set<string>();
  for (const raw of calls) {
    if (
      !isObject(raw) ||
      typeof raw.callKey !== 'string' ||
      typeof raw.functionalScriptId !== 'string'
    ) {
      throw new BusinessVersionRepositoryError('validation_failed', 'Scenario call is invalid');
    }
    if (callKeys.has(raw.callKey)) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        'Scenario callKey must be unique'
      );
    }
    if (!scriptIds.has(raw.functionalScriptId)) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        `Scenario call ${raw.callKey} references a missing functional script`
      );
    }
    callKeys.add(raw.callKey);
  }
  const adjacency = new Map(Array.from(callKeys, (key) => [key, [] as string[]]));
  const indegree = new Map(Array.from(callKeys, (key) => [key, 0]));
  for (const raw of edges) {
    if (
      !isObject(raw) ||
      typeof raw.fromCallKey !== 'string' ||
      typeof raw.toCallKey !== 'string' ||
      !callKeys.has(raw.fromCallKey) ||
      !callKeys.has(raw.toCallKey)
    ) {
      throw new BusinessVersionRepositoryError('validation_failed', 'Scenario edge is invalid');
    }
    const nextCalls = adjacency.get(raw.fromCallKey);
    if (!nextCalls) {
      throw new BusinessVersionRepositoryError('validation_failed', 'Scenario edge is invalid');
    }
    nextCalls.push(raw.toCallKey);
    indegree.set(raw.toCallKey, (indegree.get(raw.toCallKey) ?? 0) + 1);
  }
  const queue = Array.from(indegree, ([key, degree]) => (degree === 0 ? key : null)).filter(
    (key): key is string => key !== null
  );
  let visited = 0;
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    visited += 1;
    for (const next of adjacency.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  if (visited !== callKeys.size) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'Scenario call graph must be acyclic'
    );
  }
}

function pageSignature(payload: JsonObject): string {
  if (
    (payload.routeMode !== 'path' && payload.routeMode !== 'hash') ||
    typeof payload.routeTemplate !== 'string' ||
    !payload.routeTemplate.startsWith('/') ||
    !isObject(payload.identityQuery)
  ) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'Page payload must contain routeMode, routeTemplate and identityQuery'
    );
  }
  return hashValue({
    routeMode: payload.routeMode,
    routeTemplate: normalizeRouteTemplate(payload.routeTemplate),
    identityQuery: payload.identityQuery,
  });
}

function normalizeRouteTemplate(value: string): string {
  if (value.includes('*') || /\/\/+/.test(value)) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'routeTemplate cannot contain wildcards or repeated separators'
    );
  }
  const withoutTrailingSlash = value.length > 1 ? value.replace(/\/$/, '') : value;
  return withoutTrailingSlash;
}

function rewriteIds(value: unknown, idMap: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value;
  if (Array.isArray(value)) return value.map((entry) => rewriteIds(entry, idMap));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, rewriteIds(child, idMap)])
  );
}

function assertNoSourceIds(graph: BusinessVersionAssetGraph, sourceIds: ReadonlySet<string>): void {
  const payloads = [
    ...graph.pages,
    ...graph.businessModules,
    ...graph.functionalModules,
    ...graph.functionalScripts,
    ...graph.scenarios,
  ].map((asset) => asset.currentRevision.payload);
  if (payloads.some((value) => containsSourceId(value, sourceIds))) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'Copied asset graph still references mutable source assets'
    );
  }
}

function containsSourceId(value: unknown, sourceIds: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return sourceIds.has(value);
  if (Array.isArray(value)) return value.some((child) => containsSourceId(child, sourceIds));
  return (
    isObject(value) && Object.values(value).some((child) => containsSourceId(child, sourceIds))
  );
}

function assertNoInlineSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoInlineSecrets(entry, `${path}[${index}]`));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (
      /(?:password|token|authorization|cookie|api[_-]?key|secret)/i.test(key) &&
      !/(?:ref|refs)$/i.test(key) &&
      child !== null &&
      child !== ''
    ) {
      throw new BusinessVersionRepositoryError(
        'validation_failed',
        `${path}.${key} must use a secret reference instead of an inline value`
      );
    }
    assertNoInlineSecrets(child, `${path}.${key}`);
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function hashValue(value: unknown): string {
  return sha256(stableStringify(value));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireMapped(map: ReadonlyMap<string, string>, id: string): string {
  const mapped = map.get(id);
  if (!mapped) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      `Copy map is missing source asset ${id}`
    );
  }
  return mapped;
}

function requireText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      `${label} must contain between 1 and 500 characters`
    );
  }
  return value;
}

function requireKey(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value)) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      `${label} must be a lowercase stable key`
    );
  }
  return value;
}

function requireRequestId(value: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200) {
    throw new BusinessVersionRepositoryError(
      'validation_failed',
      'Idempotency key must contain between 1 and 200 characters'
    );
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function translateSqliteConflict(error: unknown, message: string): BusinessVersionRepositoryError {
  if (
    error instanceof Error &&
    /(?:UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY)/i.test(
      error.message
    )
  ) {
    return new BusinessVersionRepositoryError('conflict', message, { cause: error });
  }
  return error instanceof BusinessVersionRepositoryError
    ? error
    : new BusinessVersionRepositoryError('validation_failed', 'Database write failed', {
        cause: error,
      });
}
