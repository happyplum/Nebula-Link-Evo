import { createHash } from 'node:crypto';
import type {
  AuthoringAmendmentRepository,
  AmendmentCategory,
  AmendmentRecord,
} from '../database/repositories/authoring-amendment-repository.js';
import type { CoordinatorAuthoringTask } from '../database/repositories/semantic-coordinator-repository.js';
import type {
  SemanticAssetRepository,
  SemanticAssetType,
} from '../database/repositories/semantic-asset-repository.js';
import type { SemanticQueryRepository } from '../database/repositories/semantic-query-repository.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';
import type {
  AgentTaskBrowserStep,
  AgentTaskView,
  CreateAgentTaskInput,
} from '../infrastructure/agent-task-client.js';
import type { SemanticWorkspaceV1 } from '../types/semantic-control.js';
import {
  buildSemanticBrowserSteps,
  semanticExecutionResultSchema,
} from './semantic-task-projection.js';

const AMENDMENT_CATEGORIES = new Set<AmendmentCategory>([
  'requirement',
  'script',
  'acceptance',
  'scenario_add',
  'scenario_remove',
  'scenario_reorder',
  'module_call',
  'repair',
]);

const CANDIDATE_ASSET_TYPES = new Set<SemanticAssetType>([
  'business_module',
  'functional_module',
  'functional_script',
  'test_scenario',
  'module_requirement',
]);

export interface AuthoringCandidateResult {
  status: 'candidate_ready' | 'no_change' | 'blocked';
  summary: string;
  amendment?: AmendmentRecord;
  firstCandidate?: { assetType: SemanticAssetType; assetId: string; revisionId: string };
}

export interface AuthoringVerificationResult {
  status: 'activated' | 'failed';
  summary: string;
  amendment: AmendmentRecord;
}

export class SemanticAuthoringCandidateService {
  constructor(
    private readonly queries: SemanticQueryRepository,
    private readonly assets: SemanticAssetRepository,
    private readonly amendments: AuthoringAmendmentRepository
  ) {}

  buildAgentRequest(task: CoordinatorAuthoringTask): Omit<CreateAgentTaskInput, 'browserBinding'> {
    if (isVerificationTask(task)) return this.buildVerificationAgentRequest(task);
    if (task.input.intent === 'locate_in_browser') return this.buildLocateAgentRequest(task);
    const workspace = this.requireWorkspace(task.businessVersionId);
    const context = resolveContext(task, workspace);
    return {
      schema: 'nebula.ai.agent-task/1.0',
      clientTaskId: `authoring:${task.taskId}`,
      modelRole: 'decision',
      input: {
        schema: 'nebula.ai-e2e.authoring-task-input/1.0',
        objective:
          '分析当前 URL 与冻结资产，只输出结构化候选。不得直接激活、弱化验收标准或扩展到未列出的资产。',
        jobId: task.jobId,
        taskId: task.taskId,
        taskType: task.type,
        targetType: task.targetType ?? null,
        targetId: task.targetId ?? null,
        request: task.input,
        workspace: compactWorkspace(workspace, context),
        proposalContract: {
          allowedAssetTypes: [...CANDIDATE_ASSET_TYPES],
          proposalFields: [
            'assetType',
            'assetId',
            'baseRevisionId',
            'candidatePayload',
            'category',
            'reason',
            'targetUrl',
            'targetPageDefinitionId',
            'targetFunctionalModuleId',
          ],
        },
      },
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: {
            type: 'string',
            enum: ['candidate_ready', 'no_change', 'blocked'],
          },
          summary: { type: 'string', minLength: 1, maxLength: 4_000 },
          category: {
            type: 'string',
            enum: [...AMENDMENT_CATEGORIES],
          },
          proposalsJson: { type: 'string', maxLength: 100_000 },
          validationPlanJson: { type: 'string', maxLength: 20_000 },
          potentialSideEffectsJson: { type: 'string', maxLength: 20_000 },
        },
        required: ['status', 'summary'],
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: {
          'browser-control.operation_execute': {
            steps: [
              {
                stepId: 'observe-current-page',
                kind: 'observe',
                operation: 'page_state',
                capture: { domSnapshot: true, afterScreenshot: true },
              },
            ],
          },
        },
      },
      skillPolicy: { allow: [] },
      budgets: {
        maxDurationMs: 120_000,
        maxModelTurns: 8,
        maxToolCalls: 4,
        maxTokens: 16_000,
      },
      correlation: {
        authoringJobId: task.jobId,
        authoringTaskId: task.taskId,
        businessVersionId: task.businessVersionId,
      },
    };
  }

  leaseRequirements(task: CoordinatorAuthoringTask): {
    mode: 'observe' | 'control';
    operations: string[];
  } {
    const request = this.buildAgentRequest(task);
    const constraints = objectValue(
      request.toolPolicy.constraints?.['browser-control.operation_execute']
    );
    const steps = Array.isArray(constraints.steps) ? constraints.steps.filter(isObject) : [];
    const mode = steps.some((step) => step.kind === 'act') ? 'control' : 'observe';
    return {
      mode,
      operations: [
        ...new Set(steps.map((step) => stringValue(step.operation)).filter(Boolean)),
      ] as string[],
    };
  }

  applyAgentOutput(
    task: CoordinatorAuthoringTask,
    agentTask: AgentTaskView
  ): AuthoringCandidateResult {
    if (agentTask.status !== 'completed') {
      return {
        status: 'blocked',
        summary: agentTask.error?.message ?? `Agent task ${agentTask.status}`,
      };
    }
    const output = objectValue(agentTask.output);
    const status = output.status;
    const summary = stringValue(output.summary) ?? 'Agent 未返回候选摘要';
    if (status === 'no_change') return { status, summary };
    if (status !== 'candidate_ready') return { status: 'blocked', summary };
    const workspace = this.requireWorkspace(task.businessVersionId);
    const context = resolveContext(task, workspace);
    const rawProposals = parseJsonArray(output.proposalsJson, 'proposalsJson');
    if (rawProposals.length === 0 || rawProposals.length > 20) {
      throw new Error('候选修改数量必须在 1 到 20 之间');
    }
    const proposals = rawProposals.map((raw) =>
      validateProposal(raw, task.businessVersionId, context, this.queries)
    );
    const thread = this.amendments.createContextThread({
      jobId: task.jobId,
      businessVersionId: task.businessVersionId,
      scope: {
        currentUrl: context.currentUrl,
        currentPageDefinitionId: context.pageId,
        currentFunctionalModuleId: context.moduleId,
        baseRevisionSha256: context.moduleRevisionSha256,
        visibleScenarioIds: context.visibleScenarioIds,
        context: {
          source: 'semantic_coordinator',
          authoringTaskId: task.taskId,
          agentTaskId: agentTask.taskId,
        },
      },
      createdBy: 'semantic-coordinator',
    });
    const userRequest = stringValue(task.input.reason);
    if (userRequest) {
      this.amendments.addChatMessage({
        threadId: thread.id,
        role: 'user',
        content: userRequest,
        createdBy: stringValue(task.input.requestedBy) ?? 'semantic-coordinator',
      });
    }
    const candidateChanges = proposals.map((proposal, index) => {
      const revision = this.assets.createRevision({
        id: stableUuid(agentTask.taskId, proposal.assetType, proposal.assetId, String(index)),
        assetType: proposal.assetType,
        assetId: proposal.assetId,
        businessVersionId: task.businessVersionId,
        schemaId: proposal.schemaId,
        payload: proposal.candidatePayload,
        validationStatus: 'valid',
        changeReason: proposal.reason,
        createdByType: 'main_agent',
        createdById: agentTask.taskId,
        supersedesRevisionId: proposal.baseRevisionId,
        sourceRevisionId: proposal.baseRevisionId,
        changeKind: 'ai_repair',
      });
      return {
        revision,
        change: {
          assetType: proposal.assetType,
          assetId: proposal.assetId,
          baseRevisionId: proposal.baseRevisionId,
          baseRevisionSha256: proposal.baseRevisionSha256,
          candidateRevisionId: revision.id,
          targetPageDefinitionId: proposal.targetPageDefinitionId,
          ...(proposal.targetFunctionalModuleId
            ? { targetFunctionalModuleId: proposal.targetFunctionalModuleId }
            : {}),
          targetUrl: proposal.targetUrl,
          category: proposal.category,
          diff: {
            changedFields: changedFields(proposal.basePayload, proposal.candidatePayload),
            baseSha256: proposal.baseRevisionSha256,
            candidateSha256: revision.contentSha256,
            reason: proposal.reason,
          },
          dependencies: [],
        },
      };
    });
    const category = AMENDMENT_CATEGORIES.has(output.category as AmendmentCategory)
      ? (output.category as AmendmentCategory)
      : 'repair';
    const amendment = this.amendments.createAmendment({
      jobId: task.jobId,
      threadId: thread.id,
      idempotencyKey: `agent-task:${agentTask.taskId}`,
      reason: summary,
      category,
      changes: candidateChanges.map((entry) => entry.change),
      validationPlan: parseJsonObject(output.validationPlanJson, {
        strategy: 'static_then_browser_verification',
        affectedAssetIds: candidateChanges.map((entry) => entry.revision.assetId),
      }),
      potentialSideEffects: parseJsonObject(output.potentialSideEffectsJson, {}),
      createdBy: 'semantic-coordinator',
    }).amendment;
    this.amendments.addChatMessage({
      threadId: thread.id,
      role: 'assistant',
      content: summary,
      amendmentId: amendment.id,
      createdBy: 'semantic-coordinator',
    });
    const first = candidateChanges[0];
    if (!first) throw new Error('候选修改不能为空');
    return {
      status: 'candidate_ready',
      summary,
      amendment,
      firstCandidate: {
        assetType: first.revision.assetType,
        assetId: first.revision.assetId,
        revisionId: first.revision.id,
      },
    };
  }

  applyVerificationOutput(
    task: CoordinatorAuthoringTask,
    agentTask: AgentTaskView
  ): AuthoringVerificationResult {
    const amendmentId = requiredString(task.input.amendmentId, 'amendmentId');
    const amendment = this.amendments.getAmendment(amendmentId);
    if (!amendment || amendment.jobId !== task.jobId) {
      throw new Error('验证任务关联的候选修改不存在');
    }
    const output = objectValue(agentTask.output);
    const result = stringValue(output.result);
    const summary =
      stringValue(output.summary) ?? agentTask.error?.message ?? '浏览器验证未返回摘要';
    const hasSuccessfulOperation = agentTask.toolCalls.some((call) => call.status === 'succeeded');
    if (agentTask.status === 'completed' && result === 'succeeded' && hasSuccessfulOperation) {
      return {
        status: 'activated',
        summary,
        amendment: this.amendments.activate(amendmentId, agentTask.taskId),
      };
    }
    return {
      status: 'failed',
      summary,
      amendment: this.amendments.fail(amendmentId, {
        code:
          agentTask.status !== 'completed'
            ? `agent_${agentTask.status}`
            : !hasSuccessfulOperation
              ? 'verification_operation_missing'
              : (result ?? 'verification_failed'),
        summary,
        agentTaskId: agentTask.taskId,
      }),
    };
  }

  private buildVerificationAgentRequest(
    task: CoordinatorAuthoringTask
  ): Omit<CreateAgentTaskInput, 'browserBinding'> {
    const amendmentId = requiredString(task.input.amendmentId, 'amendmentId');
    const amendment = this.amendments.getAmendment(amendmentId);
    if (!amendment || amendment.jobId !== task.jobId || amendment.state !== 'verifying') {
      throw new Error('Authoring amendment is not verifying');
    }
    const workspace = this.requireWorkspace(task.businessVersionId);
    const candidates = amendment.changes.map((change) => {
      const assetType = requiredString(change.assetType, 'change.assetType') as SemanticAssetType;
      const assetId = requiredString(change.assetId, 'change.assetId');
      const revisionId = requiredString(change.candidateRevisionId, 'change.candidateRevisionId');
      const revision = this.queries.getRevision(assetType, assetId, revisionId);
      if (!revision) throw new Error('候选 revision 不存在');
      return { assetType, assetId, revisionId, payload: revision.payload };
    });
    const steps = buildVerificationSteps(candidates, workspace);
    const toolPolicy = {
      allow: ['browser-control.operation_execute'],
      constraints: { 'browser-control.operation_execute': { steps } },
    };
    return {
      schema: 'nebula.ai.agent-task/1.0',
      clientTaskId: `authoring-verification:${task.taskId}`,
      modelRole: 'decision',
      input: {
        schema: 'nebula.ai-e2e.authoring-verification-input/1.0',
        objective:
          '在冻结候选和批准范围内完成真实浏览器验证。不得改写候选或弱化验收；任何断言失败或副作用结果未知都必须返回失败结果。',
        jobId: task.jobId,
        taskId: task.taskId,
        amendmentId,
        impact: amendment.impact,
        validationPlan: amendment.validationPlan,
        candidates,
        authorizedSteps: steps,
      },
      responseSchema: semanticExecutionResultSchema(),
      toolPolicy,
      skillPolicy: { allow: [] },
      budgets: {
        maxDurationMs: 5 * 60_000,
        maxModelTurns: 12,
        maxToolCalls: Math.min(50, Math.max(steps.length * 2, 8)),
        maxTokens: 24_000,
      },
      correlation: {
        authoringJobId: task.jobId,
        authoringTaskId: task.taskId,
        amendmentId,
        businessVersionId: task.businessVersionId,
      },
    };
  }

  private buildLocateAgentRequest(
    task: CoordinatorAuthoringTask
  ): Omit<CreateAgentTaskInput, 'browserBinding'> {
    const workspace = this.requireWorkspace(task.businessVersionId);
    const context = resolveContext(task, workspace);
    const steps: AgentTaskBrowserStep[] = [
      {
        stepId: 'locate-target-url',
        kind: 'act',
        operation: 'navigate',
        capture: { beforeScreenshot: true, afterScreenshot: true, domSnapshot: true },
      },
      {
        stepId: 'observe-located-page',
        kind: 'observe',
        operation: 'page_state',
        capture: { afterScreenshot: true, domSnapshot: true },
      },
    ];
    return {
      schema: 'nebula.ai.agent-task/1.0',
      clientTaskId: `authoring-locate:${task.taskId}`,
      modelRole: 'decision',
      input: {
        schema: 'nebula.ai-e2e.browser-locate-input/1.0',
        objective: '仅导航到目标 URL 并确认页面已到达，不生成或修改任何候选资产。',
        jobId: task.jobId,
        taskId: task.taskId,
        targetUrl: context.currentUrl,
        pageDefinitionId: context.pageId,
        functionalModuleId: context.moduleId,
        authorizedSteps: steps,
      },
      responseSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['no_change', 'blocked'] },
          summary: { type: 'string', minLength: 1, maxLength: 4_000 },
        },
        required: ['status', 'summary'],
      },
      toolPolicy: {
        allow: ['browser-control.operation_execute'],
        constraints: { 'browser-control.operation_execute': { steps } },
      },
      skillPolicy: { allow: [] },
      budgets: {
        maxDurationMs: 120_000,
        maxModelTurns: 4,
        maxToolCalls: 4,
        maxTokens: 8_000,
      },
      correlation: {
        authoringJobId: task.jobId,
        authoringTaskId: task.taskId,
        businessVersionId: task.businessVersionId,
      },
    };
  }

  private requireWorkspace(versionId: string): SemanticWorkspaceV1 {
    const workspace = this.queries.getWorkspace(versionId);
    if (!workspace) throw new Error('Authoring business version workspace not found');
    return workspace;
  }
}

interface AuthoringContext {
  currentUrl: string;
  pageId: string;
  moduleId: string;
  moduleRevisionSha256: string;
  visibleScenarioIds: string[];
}

interface ValidatedProposal {
  assetType: SemanticAssetType;
  assetId: string;
  baseRevisionId: string;
  baseRevisionSha256: string;
  schemaId: string;
  basePayload: Record<string, unknown>;
  candidatePayload: Record<string, unknown>;
  category: string;
  reason: string;
  targetUrl: string;
  targetPageDefinitionId: string;
  targetFunctionalModuleId?: string;
}

interface VerificationCandidate {
  assetType: SemanticAssetType;
  assetId: string;
  revisionId: string;
  payload: Record<string, unknown>;
}

function resolveContext(
  task: CoordinatorAuthoringTask,
  workspace: SemanticWorkspaceV1
): AuthoringContext {
  let module =
    task.targetType === 'functional_module'
      ? workspace.functionalModules.find((entry) => entry.id === task.targetId)
      : undefined;
  if (!module && task.targetType === 'functional_script') {
    const script = workspace.functionalScripts.find((entry) => entry.id === task.targetId);
    module = workspace.functionalModules.find((entry) => entry.id === script?.functionalModuleId);
  }
  if (!module && task.targetType === 'test_scenario') {
    const scenario = workspace.scenarios.find((entry) => entry.id === task.targetId);
    const calls = Array.isArray(scenario?.currentRevision.payload.calls)
      ? scenario.currentRevision.payload.calls
      : [];
    const firstCall = calls.find(isObject);
    const scriptId = firstCall ? stringValue(firstCall.functionalScriptId) : undefined;
    const script = workspace.functionalScripts.find((entry) => entry.id === scriptId);
    module = workspace.functionalModules.find((entry) => entry.id === script?.functionalModuleId);
  }
  module ??= workspace.functionalModules[0];
  if (!module) throw new Error('Authoring context has no functional module');
  const page = workspace.pages.find((entry) => entry.id === module.primaryPageDefinitionId);
  if (!page) throw new Error('Authoring context module has no primary page');
  const currentUrl = stringValue(task.input.currentUrl) ?? `workspace://page/${page.id}`;
  const visibleScripts = new Set(
    workspace.functionalScripts
      .filter((script) => {
        const owner = workspace.functionalModules.find(
          (entry) => entry.id === script.functionalModuleId
        );
        return owner?.primaryPageDefinitionId === page.id;
      })
      .map((script) => script.id)
  );
  const visibleScenarioIds = workspace.scenarios
    .filter((scenario) => {
      const calls = scenario.currentRevision.payload.calls;
      return (
        Array.isArray(calls) &&
        calls.some((call) => isObject(call) && visibleScripts.has(String(call.functionalScriptId)))
      );
    })
    .map((scenario) => scenario.id);
  return {
    currentUrl,
    pageId: page.id,
    moduleId: module.id,
    moduleRevisionSha256: module.currentRevision.contentSha256,
    visibleScenarioIds,
  };
}

function validateProposal(
  value: unknown,
  businessVersionId: string,
  context: AuthoringContext,
  queries: SemanticQueryRepository
): ValidatedProposal {
  const proposal = objectValue(value);
  const assetType = requiredString(proposal.assetType, 'proposal.assetType') as SemanticAssetType;
  if (!CANDIDATE_ASSET_TYPES.has(assetType))
    throw new Error(`候选资产类型 '${assetType}' 不允许自动修改`);
  const assetId = requiredString(proposal.assetId, 'proposal.assetId');
  const baseRevisionId = requiredString(proposal.baseRevisionId, 'proposal.baseRevisionId');
  const base = queries.getRevision(assetType, assetId, baseRevisionId);
  if (!base) throw new Error('候选基础 revision 不存在');
  const candidatePayload = objectValue(proposal.candidatePayload);
  if (candidatePayload.schema !== base.schemaId)
    throw new Error('候选 payload schema 与基础 revision 不一致');
  if (hashValue(candidatePayload) === base.contentSha256)
    throw new Error('候选 payload 与基础 revision 完全相同');
  const category = requiredString(proposal.category, 'proposal.category');
  const reason = requiredString(proposal.reason, 'proposal.reason');
  const targetUrl = stringValue(proposal.targetUrl) ?? context.currentUrl;
  const targetPageDefinitionId = stringValue(proposal.targetPageDefinitionId) ?? context.pageId;
  const targetFunctionalModuleId = stringValue(proposal.targetFunctionalModuleId);
  if (!businessVersionId) throw new Error('businessVersionId is required');
  return {
    assetType,
    assetId,
    baseRevisionId,
    baseRevisionSha256: base.contentSha256,
    schemaId: base.schemaId,
    basePayload: base.payload,
    candidatePayload,
    category,
    reason,
    targetUrl,
    targetPageDefinitionId,
    ...(targetFunctionalModuleId ? { targetFunctionalModuleId } : {}),
  };
}

function compactWorkspace(
  workspace: SemanticWorkspaceV1,
  context: AuthoringContext
): Record<string, unknown> {
  const visibleScenarios = workspace.scenarios.filter((scenario) =>
    context.visibleScenarioIds.includes(scenario.id)
  );
  const referencedScriptIds = new Set(
    visibleScenarios.flatMap((scenario) => {
      const calls = scenario.currentRevision.payload.calls;
      return Array.isArray(calls)
        ? calls
            .filter(isObject)
            .map((call) => stringValue(call.functionalScriptId))
            .filter((id): id is string => Boolean(id))
        : [];
    })
  );
  const pageModuleIds = new Set(
    workspace.functionalModules
      .filter((module) => module.primaryPageDefinitionId === context.pageId)
      .map((module) => module.id)
  );
  const scripts = workspace.functionalScripts.filter(
    (script) => pageModuleIds.has(script.functionalModuleId) || referencedScriptIds.has(script.id)
  );
  const moduleIds = new Set([
    ...pageModuleIds,
    ...scripts.map((script) => script.functionalModuleId),
  ]);
  const modules = workspace.functionalModules.filter((module) => moduleIds.has(module.id));
  const pageIds = new Set([
    context.pageId,
    ...modules.map((module) => module.primaryPageDefinitionId),
  ]);
  const compact = {
    schema: workspace.schema,
    version: workspace.version,
    prdDocuments: workspace.prdDocuments.slice(0, 4).map((document) => ({
      id: document.id,
      documentKey: document.documentKey,
      rawContent: document.rawContent.slice(0, 12_000),
      contentSha256: document.contentSha256,
    })),
    pages: workspace.pages.filter((page) => pageIds.has(page.id)),
    businessModules: workspace.businessModules,
    functionalModules: modules,
    functionalScripts: scripts,
    scenarios: visibleScenarios,
    validations: workspace.validations,
  };
  if (Buffer.byteLength(JSON.stringify(compact), 'utf8') > 100_000) {
    throw new Error('当前 URL 的 Authoring 上下文超过 100KB，请缩小模块或场景范围');
  }
  return compact;
}

function isVerificationTask(task: CoordinatorAuthoringTask): boolean {
  return task.targetType === 'authoring_amendment' && typeof task.input.amendmentId === 'string';
}

function buildVerificationSteps(
  candidates: VerificationCandidate[],
  workspace: SemanticWorkspaceV1
): AgentTaskBrowserStep[] {
  const candidateScripts = new Map(
    candidates
      .filter((candidate) => candidate.assetType === 'functional_script')
      .map((candidate) => [candidate.assetId, candidate.payload] as const)
  );
  const scripts: Array<{ key: string; payload: Record<string, unknown> }> = candidates
    .filter((candidate) => candidate.assetType === 'functional_script')
    .map((candidate) => ({ key: candidate.assetId, payload: candidate.payload }));
  for (const scenario of candidates.filter(
    (candidate) => candidate.assetType === 'test_scenario'
  )) {
    const calls = Array.isArray(scenario.payload.calls) ? scenario.payload.calls : [];
    for (const [index, call] of calls.entries()) {
      if (!isObject(call)) continue;
      const scriptId = stringValue(call.functionalScriptId);
      if (!scriptId) continue;
      const payload =
        candidateScripts.get(scriptId) ??
        workspace.functionalScripts.find((script) => script.id === scriptId)?.currentRevision
          .payload;
      if (payload) scripts.push({ key: `${scenario.assetId}-${index + 1}-${scriptId}`, payload });
    }
  }
  if (scripts.length === 0) {
    return [
      {
        stepId: 'verify-current-page',
        kind: 'observe',
        operation: 'page_state',
        capture: { domSnapshot: true, afterScreenshot: true },
      },
    ];
  }
  const steps = scripts.flatMap((script, scriptIndex) =>
    buildSemanticBrowserSteps(script.payload).map((step, stepIndex) => ({
      ...step,
      stepId: `verify-${scriptIndex + 1}-${stepIndex + 1}-${step.stepId}`.slice(0, 120),
    }))
  );
  if (steps.length > 100) throw new Error('候选验证展开后超过 Agent task 的 100 步上限');
  return steps;
}

function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(
      (key) =>
        hashValue({ present: Object.hasOwn(before, key), value: before[key] }) !==
        hashValue({ present: Object.hasOwn(after, key), value: after[key] })
    )
    .sort();
}

function parseJsonArray(value: unknown, label: string): unknown[] {
  if (typeof value !== 'string') throw new Error(`${label} is required`);
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be an array`);
  return parsed;
}

function parseJsonObject(
  value: unknown,
  fallback: Record<string, unknown>
): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return fallback;
  const parsed = JSON.parse(value) as unknown;
  return isObject(parsed) ? parsed : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function stableUuid(...parts: string[]): string {
  const bytes = createHash('sha256').update(parts.join('\0')).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
