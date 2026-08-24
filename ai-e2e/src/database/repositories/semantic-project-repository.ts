import { randomUUID } from 'node:crypto';
import type { DeploymentEnvironment, SemanticProjectSummary, SemanticProjectWorkspace } from '../../types/semantic-project.js';
import {
  assertNoInlineSecrets,
  hashValue,
  inImmediateTransaction,
  sha256,
  stableStringify,
  type DatabaseLike,
  type SupportedDatabase,
} from './semantic-repository-utils.js';

export type SemanticProjectRepositoryErrorCode = 'not_found' | 'conflict' | 'validation_failed';

export class SemanticProjectRepositoryError extends Error {
  constructor(readonly code: SemanticProjectRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'SemanticProjectRepositoryError';
  }
}

export interface CreateSemanticProjectWorkspaceInput {
  name: string;
  description?: string;
  versionKey: string;
  versionName: string;
  targetOrigin: string;
  environment: DeploymentEnvironment;
  prd: { format: 'markdown' | 'plain_text'; content: string };
  createdBy: string;
  idempotencyKey: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  create_request_id: string;
  request_hash: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class SemanticProjectRepository {
  private readonly db: DatabaseLike;

  constructor(database: SupportedDatabase) {
    this.db = database as unknown as DatabaseLike;
  }

  createWorkspace(input: CreateSemanticProjectWorkspaceInput): { data: SemanticProjectWorkspace; created: boolean } {
    const normalized = normalizeInput(input);
    const requestHash = hashValue(normalized);
    const existing = this.findByRequest(input.idempotencyKey);
    if (existing) return { data: this.replay(existing, requestHash), created: false };

    return inImmediateTransaction(this.db, () => {
      const raced = this.findByRequest(input.idempotencyKey);
      if (raced) return { data: this.replay(raced, requestHash), created: false };

      const projectId = randomUUID();
      const deploymentProfileId = randomUUID();
      const deploymentRevisionId = randomUUID();
      const versionId = randomUUID();
      const prdId = randomUUID();
      const pageId = randomUUID();
      const pageRevisionId = randomUUID();
      const businessModuleId = randomUUID();
      const businessModuleRevisionId = randomUUID();
      const functionalModuleId = randomUUID();
      const functionalModuleRevisionId = randomUUID();
      const scriptId = randomUUID();
      const scriptRevisionId = randomUUID();
      const scenarioId = randomUUID();
      const scenarioRevisionId = randomUUID();
      const now = new Date().toISOString();
      const deploymentPayload = {
        schema: 'nebula.ai-e2e.deployment/1.0',
        origin: normalized.targetOrigin,
        basePath: '/',
        environment: normalized.environment,
        allowedOrigins: [normalized.targetOrigin],
      };

      try {
        this.db.prepare(
          `INSERT INTO projects
            (id, name, description, create_request_id, request_hash, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          projectId,
          normalized.name,
          normalized.description ?? null,
          normalized.idempotencyKey,
          requestHash,
          normalized.createdBy,
          now,
          now
        );
        this.db.prepare(
          `INSERT INTO deployment_profiles
            (id, project_id, profile_key, name, created_at)
           VALUES (?, ?, 'default', '默认环境', ?)`
        ).run(deploymentProfileId, projectId, now);
        const deploymentJson = stableStringify(deploymentPayload);
        this.db.prepare(
          `INSERT INTO deployment_profile_revisions
            (id, deployment_profile_id, revision_no, lifecycle, schema_id, payload_json,
             content_sha256, validation_status, change_reason, created_by_type, created_by_id,
             created_at, validated_at)
           VALUES (?, ?, 1, 'current', ?, ?, ?, 'valid', 'initial_create', 'user', ?, ?, ?)`
        ).run(
          deploymentRevisionId,
          deploymentProfileId,
          deploymentPayload.schema,
          deploymentJson,
          hashValue(deploymentPayload),
          normalized.createdBy,
          now,
          now
        );
        this.db.prepare(
          `INSERT INTO business_versions
            (id, project_id, version_key, name, create_request_id, request_hash,
             validation_status, schema_version, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'needs_recheck', 1, ?, ?, ?)`
        ).run(
          versionId,
          projectId,
          normalized.versionKey,
          normalized.versionName,
          normalized.idempotencyKey,
          hashValue({ projectId, versionKey: normalized.versionKey, requestHash }),
          normalized.createdBy,
          now,
          now
        );
        this.insertStarterGraph({
          versionId,
          createdBy: normalized.createdBy,
          now,
          pageId,
          pageRevisionId,
          businessModuleId,
          businessModuleRevisionId,
          functionalModuleId,
          functionalModuleRevisionId,
          scriptId,
          scriptRevisionId,
          scenarioId,
          scenarioRevisionId,
          projectName: normalized.name,
        });
        this.db.prepare(
          `INSERT INTO version_deployment_bindings
            (business_version_id, deployment_revision_id, binding_key, is_default, created_at)
           VALUES (?, ?, 'default', 1, ?)`
        ).run(versionId, deploymentRevisionId, now);
        this.db.prepare(
          `INSERT INTO version_prd_documents
            (id, business_version_id, document_key, format, raw_content, content_sha256,
             is_current, created_at)
           VALUES (?, ?, 'primary', ?, ?, ?, 1, ?)`
        ).run(
          prdId,
          versionId,
          normalized.prd.format,
          normalized.prd.content,
          sha256(normalized.prd.content),
          now
        );
      } catch (error) {
        if (error instanceof Error && /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(error.message)) {
          throw new SemanticProjectRepositoryError('conflict', '项目、版本键或幂等键已存在');
        }
        throw error;
      }

      return {
        created: true,
        data: {
          id: projectId,
          name: normalized.name,
          ...(normalized.description ? { description: normalized.description } : {}),
          createdBy: normalized.createdBy,
          createdAt: now,
          updatedAt: now,
          latestVersion: {
            id: versionId,
            versionKey: normalized.versionKey,
            name: normalized.versionName,
            validationStatus: 'needs_recheck',
          },
          versionId,
          deploymentRevisionId,
        },
      };
    });
  }

  private insertStarterGraph(input: {
    versionId: string;
    createdBy: string;
    now: string;
    pageId: string;
    pageRevisionId: string;
    businessModuleId: string;
    businessModuleRevisionId: string;
    functionalModuleId: string;
    functionalModuleRevisionId: string;
    scriptId: string;
    scriptRevisionId: string;
    scenarioId: string;
    scenarioRevisionId: string;
    projectName: string;
  }): void {
    const page = {
      schema: 'nebula.ai-e2e.page-definition/1.0',
      name: '起始页面',
      routeMode: 'path',
      routeTemplate: '/',
      identityQuery: {},
      recognition: { status: 'bootstrap_pending' },
    };
    const businessModule = {
      schema: 'nebula.ai-e2e.business-module/1.0',
      name: input.projectName,
      goal: '等待 Agent 根据 PRD 与浏览器证据完成业务分解',
    };
    const functionalModule = {
      schema: 'nebula.ai-e2e.functional-module/1.0',
      name: '待编排模块',
      goal: '建立首个可验证功能模块',
      primaryPageDefinitionId: input.pageId,
    };
    const script = {
      schema: 'nebula.ai-e2e.functional-script/1.0',
      scriptKey: 'bootstrap.observe',
      name: '观察起始页面',
      purpose: '仅采集初始页面证据，等待 bootstrap 候选替换',
      moduleId: input.functionalModuleId,
      pageScope: { entryPageId: input.pageId, allowedTransitions: [] },
      inputs: [],
      preconditions: [],
      steps: [{ id: 'observe-initial-page', action: { type: 'observe' }, postconditions: [] }],
      finalAssertions: [],
      outputs: [],
      sideEffects: [],
    };
    const scenario = {
      schema: 'nebula.ai-e2e.scenario/1.0',
      scenarioKey: 'bootstrap',
      name: '初始页面检查',
      calls: [
        { callKey: 'observe_initial_page', functionalScriptId: input.scriptId, inputBindings: {} },
      ],
      edges: [],
    };
    const insertRevision = (
      table: string,
      assetColumn: string,
      revisionId: string,
      assetId: string,
      payload: Record<string, unknown>,
      extraColumns = '',
      extraPlaceholders = '',
      extraValues: unknown[] = []
    ) => {
      const payloadJson = stableStringify(payload);
      this.db.prepare(
        `INSERT INTO ${table}
          (id, business_version_id, ${assetColumn}, revision_no, lifecycle, schema_id,
           payload_json, content_sha256, validation_status, change_reason, created_by_type,
           created_by_id, created_at, validated_at${extraColumns})
         VALUES (?, ?, ?, 1, 'current', ?, ?, ?, 'valid', 'initial_semantic_skeleton',
           'user', ?, ?, ?${extraPlaceholders})`
      ).run(
        revisionId,
        input.versionId,
        assetId,
        String(payload.schema),
        payloadJson,
        sha256(payloadJson),
        input.createdBy,
        input.now,
        input.now,
        ...extraValues
      );
    };
    this.db.prepare(
      'INSERT INTO page_definitions (id, business_version_id, page_key, created_at) VALUES (?, ?, ?, ?)'
    ).run(input.pageId, input.versionId, 'root', input.now);
    insertRevision(
      'page_definition_revisions',
      'page_definition_id',
      input.pageRevisionId,
      input.pageId,
      page,
      ', page_signature_sha256',
      ', ?',
      [hashValue({ routeMode: 'path', routeTemplate: '/', identityQuery: {} })]
    );
    this.db.prepare(
      'INSERT INTO semantic_business_modules (id, business_version_id, module_key, created_at) VALUES (?, ?, ?, ?)'
    ).run(input.businessModuleId, input.versionId, 'product', input.now);
    insertRevision(
      'semantic_business_module_revisions',
      'business_module_id',
      input.businessModuleRevisionId,
      input.businessModuleId,
      businessModule
    );
    this.db.prepare(
      `INSERT INTO semantic_functional_modules
        (id, business_version_id, business_module_id, module_key, primary_page_definition_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.functionalModuleId,
      input.versionId,
      input.businessModuleId,
      'bootstrap',
      input.pageId,
      input.now
    );
    insertRevision(
      'semantic_functional_module_revisions',
      'functional_module_id',
      input.functionalModuleRevisionId,
      input.functionalModuleId,
      functionalModule
    );
    this.db.prepare(
      `INSERT INTO functional_scripts
        (id, business_version_id, functional_module_id, script_key, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(input.scriptId, input.versionId, input.functionalModuleId, 'bootstrap.observe', '观察起始页面', input.now);
    insertRevision(
      'functional_script_revisions',
      'functional_script_id',
      input.scriptRevisionId,
      input.scriptId,
      script,
      ', readiness_status, change_kind',
      ", 'unverified', 'generated'"
    );
    this.db.prepare(
      `INSERT INTO semantic_test_scenarios
        (id, business_version_id, scenario_key, name, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(input.scenarioId, input.versionId, 'bootstrap', '初始页面检查', input.now);
    insertRevision(
      'semantic_test_scenario_revisions',
      'test_scenario_id',
      input.scenarioRevisionId,
      input.scenarioId,
      scenario,
      ', readiness_status',
      ", 'unverified'"
    );
  }

  list(): SemanticProjectSummary[] {
    const rows = this.db.prepare(
      `SELECT p.*,
              v.id AS version_id, v.version_key, v.name AS version_name,
              v.validation_status AS version_validation_status
       FROM projects p
       LEFT JOIN business_versions v ON v.id = (
         SELECT latest.id FROM business_versions latest
         WHERE latest.project_id = p.id AND latest.archived_at IS NULL
         ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
       )
       ORDER BY p.updated_at DESC, p.id DESC`
    ).all() as Array<ProjectRow & Record<string, unknown>>;
    return rows.map(mapProject);
  }

  findById(id: string): SemanticProjectSummary | null {
    const row = this.db.prepare(
      `SELECT p.*,
              v.id AS version_id, v.version_key, v.name AS version_name,
              v.validation_status AS version_validation_status
       FROM projects p
       LEFT JOIN business_versions v ON v.id = (
         SELECT latest.id FROM business_versions latest
         WHERE latest.project_id = p.id AND latest.archived_at IS NULL
         ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1
       )
       WHERE p.id = ?`
    ).get(id) as (ProjectRow & Record<string, unknown>) | undefined;
    return row ? mapProject(row) : null;
  }

  private findByRequest(idempotencyKey: string): ProjectRow | null {
    return (this.db.prepare('SELECT * FROM projects WHERE create_request_id = ?').get(idempotencyKey) as ProjectRow | undefined) ?? null;
  }

  private replay(row: ProjectRow, requestHash: string): SemanticProjectWorkspace {
    if (row.request_hash !== requestHash) {
      throw new SemanticProjectRepositoryError('conflict', '幂等键已被不同的项目请求使用');
    }
    const project = this.findById(row.id);
    if (!project?.latestVersion) {
      throw new SemanticProjectRepositoryError('conflict', '项目初始化记录不完整');
    }
    const binding = this.db.prepare(
      `SELECT deployment_revision_id FROM version_deployment_bindings
       WHERE business_version_id = ? AND is_default = 1`
    ).get(project.latestVersion.id) as { deployment_revision_id: string } | undefined;
    if (!binding) throw new SemanticProjectRepositoryError('conflict', '项目部署绑定不完整');
    return {
      ...project,
      versionId: project.latestVersion.id,
      deploymentRevisionId: binding.deployment_revision_id,
    };
  }
}

function normalizeInput(input: CreateSemanticProjectWorkspaceInput): CreateSemanticProjectWorkspaceInput {
  const name = requiredText(input.name, '项目名称', 200);
  const versionName = requiredText(input.versionName, '业务版本名称', 200);
  const createdBy = requiredText(input.createdBy, '创建人', 200);
  const description = input.description?.trim();
  if (description && description.length > 2_000) throw new SemanticProjectRepositoryError('validation_failed', '项目说明最多 2000 字');
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(input.versionKey)) {
    throw new SemanticProjectRepositoryError('validation_failed', '业务版本键必须是小写稳定键');
  }
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    throw new SemanticProjectRepositoryError('validation_failed', '幂等键长度必须在 1 到 200 之间');
  }
  let url: URL;
  try {
    url = new URL(input.targetOrigin);
  } catch {
    throw new SemanticProjectRepositoryError('validation_failed', '目标地址必须是有效 URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new SemanticProjectRepositoryError('validation_failed', '目标地址必须是无内联凭据的 HTTP(S) Origin');
  }
  if (!['local', 'test', 'staging', 'production'].includes(input.environment)) {
    throw new SemanticProjectRepositoryError('validation_failed', '部署环境无效');
  }
  const content = requiredText(input.prd.content, 'PRD 内容', 1_000_000);
  const normalized = {
    ...input,
    name,
    ...(description ? { description } : { description: undefined }),
    versionName,
    targetOrigin: url.origin,
    prd: { format: input.prd.format, content },
    createdBy,
  };
  assertNoInlineSecrets({ project: { name, description }, deployment: { origin: url.origin } });
  return normalized;
}

function requiredText(value: string, label: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SemanticProjectRepositoryError('validation_failed', `${label}长度必须在 1 到 ${maxLength} 之间`);
  }
  return normalized;
}

function mapProject(row: ProjectRow & Record<string, unknown>): SemanticProjectSummary {
  return {
    id: row.id,
    name: row.name,
    ...(row.description ? { description: row.description } : {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.version_id
      ? {
          latestVersion: {
            id: String(row.version_id),
            versionKey: String(row.version_key),
            name: String(row.version_name),
            validationStatus: String(row.version_validation_status) as NonNullable<
              SemanticProjectSummary['latestVersion']
            >['validationStatus'],
          },
        }
      : {}),
  };
}
