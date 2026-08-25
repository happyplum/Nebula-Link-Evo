import { createHash, randomUUID } from 'node:crypto';
import type {
  SemanticCoordinatorRepository,
  CoordinatorBrowserJob,
  ActivePageTask,
  CoordinatorAuthoringTask,
} from '../database/repositories/semantic-coordinator-repository.js';
import type { SemanticEvidenceRepository } from '../database/repositories/semantic-evidence-repository.js';
import { hashValue } from '../database/repositories/semantic-repository-utils.js';
import type { SemanticRunControlRepository } from '../database/repositories/semantic-run-control-repository.js';
import type { SemanticWorkflowRepository } from '../database/repositories/semantic-workflow-repository.js';
import type {
  AgentTaskClientPort,
  AgentTaskView,
  CreateAgentTaskInput,
} from '../infrastructure/agent-task-client.js';
import type {
  SemanticBrowserClientPort,
  BrowserOperationRecord,
} from '../infrastructure/semantic-browser-client.js';
import { IntegrationClientError } from '../infrastructure/integration-client-error.js';
import { SemanticArtifactStore } from '../infrastructure/semantic-artifact-store.js';
import {
  EncryptedCoordinatorSecretStore,
  type CoordinatorSecretStorePort,
} from '../infrastructure/coordinator-secret-store.js';
import { buildRunTaskProjection } from './semantic-task-projection.js';
import { SemanticAuthoringCandidateService } from './semantic-authoring-candidate-service.js';

interface CoordinatorLogger {
  info(fields: unknown, message?: string): void;
  warn(fields: unknown, message?: string): void;
  error(fields: unknown, message?: string): void;
}

export interface SemanticCoordinatorOptions {
  repository: SemanticCoordinatorRepository;
  workflows: SemanticWorkflowRepository;
  evidence: SemanticEvidenceRepository;
  runs: SemanticRunControlRepository;
  agentTasks: AgentTaskClientPort;
  browser: SemanticBrowserClientPort;
  artifactStore?: SemanticArtifactStore;
  secretStore?: CoordinatorSecretStorePort;
  authoringCandidates?: SemanticAuthoringCandidateService;
  logger?: CoordinatorLogger;
  now?: () => Date;
}

interface OutboxItem extends Record<string, unknown> {
  id: string;
  context_type: 'run' | 'authoring';
  context_id: string;
  page_task_id?: string | null;
  authoring_task_id?: string | null;
  target_service: 'ai_chat_service' | 'proxy_adapter';
  command_type: string;
  payload_json_redacted: string;
  secret_binding_ref?: string | null;
  attempt_count: number;
}

const TERMINAL_AGENT_STATES = new Set([
  'completed',
  'failed',
  'interrupted',
  'cancelled',
  'blocked',
]);
const TERMINAL_RUN_STATES = new Set(['completed', 'cancelled']);

export class SemanticCoordinatorService {
  private readonly artifactStore: SemanticArtifactStore;
  private readonly secrets: CoordinatorSecretStorePort;
  private readonly now: () => Date;
  private initialized = false;
  private ticking = false;
  private capabilitySnapshot?: { checkedAt: number; sha256: string };

  constructor(private readonly options: SemanticCoordinatorOptions) {
    this.artifactStore = options.artifactStore ?? new SemanticArtifactStore();
    this.secrets = options.secretStore ?? new EncryptedCoordinatorSecretStore();
    this.now = options.now ?? (() => new Date());
  }

  initialize(): { recoveredOutbox: number } {
    if (this.initialized) return { recoveredOutbox: 0 };
    const recoveredOutbox = this.options.evidence.recoverDispatchingOutbox(this.isoNow());
    this.initialized = true;
    if (recoveredOutbox > 0) {
      this.options.logger?.warn({ recoveredOutbox }, '已恢复协调器重启前的 dispatching outbox');
    }
    return { recoveredOutbox };
  }

  async tick(): Promise<{ action: string }> {
    if (this.ticking) return { action: 'already_running' };
    this.ticking = true;
    try {
      this.initialize();
      const verificationAmendmentId = this.options.repository.getVerificationAmendmentToSchedule();
      if (verificationAmendmentId) {
        this.options.workflows.ensureAuthoringVerification(verificationAmendmentId);
        return { action: 'authoring_verification.scheduled' };
      }
      const capabilitySha256 = await this.preflight();
      const job = this.options.repository.getActiveBrowserJob();
      if (job?.contextType === 'run') {
        const activeTask = this.options.repository.getActivePageTask(job.id);
        if (activeTask) {
          const reconciled = await this.reconcilePageTask(activeTask);
          if (reconciled) return { action: reconciled };
        }
      } else if (job?.contextType === 'authoring') {
        const task = this.options.repository.getAuthoringTask(job.contextId, 'running');
        if (task) {
          const reconciled = await this.reconcileAuthoringTask(task);
          if (reconciled) return { action: reconciled };
        }
      }

      const outbox = this.options.evidence.claimNextOutbox(this.isoNow()) as OutboxItem | null;
      if (outbox) {
        await this.dispatchOutbox(outbox, capabilitySha256);
        return { action: `outbox:${outbox.command_type}` };
      }

      const currentJob = this.options.repository.getActiveBrowserJob();
      if (!currentJob) {
        const claimed = this.options.workflows.claimNextBrowserJob();
        if (!claimed) return { action: 'idle' };
        const claimedJob = mapClaimedJob(claimed);
        this.enqueueSessionCreate(claimedJob);
        return { action: 'browser_job.claimed' };
      }

      if (currentJob.state === 'acquiring') {
        this.enqueueSessionCreate(currentJob);
        return { action: 'browser_session.queued' };
      }

      if (currentJob.state === 'active') {
        if (currentJob.contextType === 'run') {
          const lifecycle = this.options.repository.getRunLifecycle(currentJob.contextId);
          if (lifecycle && TERMINAL_RUN_STATES.has(lifecycle)) {
            this.enqueueSessionClose(currentJob, 'run_terminal');
            return { action: 'browser_session.close_queued' };
          }
          const todo = this.options.repository.getReadyTodo(currentJob.id);
          if (todo) {
            this.enqueueLeaseCreate(todo);
            return { action: 'browser_lease.queued' };
          }
        } else {
          const lifecycle = this.options.repository.getAuthoringJobLifecycle(currentJob.contextId);
          if (
            lifecycle &&
            ['paused', 'waiting_decision', 'completed', 'cancelled', 'failed'].includes(lifecycle)
          ) {
            this.enqueueSessionClose(currentJob, 'authoring_safe_boundary');
            return { action: 'browser_session.close_queued' };
          }
          const task = this.options.repository.getAuthoringTask(currentJob.contextId, 'ready');
          if (task) {
            this.enqueueAuthoringLeaseCreate(task);
            return { action: 'authoring_browser_lease.queued' };
          }
        }
      }
      return { action: 'idle' };
    } finally {
      this.ticking = false;
    }
  }

  private async preflight(): Promise<string> {
    const now = this.now().getTime();
    if (this.capabilitySnapshot && now - this.capabilitySnapshot.checkedAt < 30_000) {
      return this.capabilitySnapshot.sha256;
    }
    const [agent, browser] = await Promise.all([
      this.options.agentTasks.getCapabilities(),
      this.options.browser.getCapabilities(),
    ]);
    requireCapability(agent, 'ai-chat-service', 'nebula.ai.agent-task');
    requireCapability(browser, 'proxy-adapter', 'browserExecution');
    const browserLimits = objectValue(browser.limits);
    if (
      browserLimits.maxActiveBrowserSessions !== 1 ||
      browserLimits.maxBrowserContextsPerSession !== 1
    ) {
      throw new IntegrationClientError(
        'proxy-adapter',
        'capability_mismatch',
        'proxy-adapter 未声明 semantic v1 所需的单会话、单 Context 边界',
        false
      );
    }
    const agentFeatures = objectValue(agent.features);
    const browserFeatures = objectValue(browser.features);
    if (agentFeatures.localControlPlane !== true || browserFeatures.localControlPlane !== true) {
      throw new IntegrationClientError(
        agentFeatures.localControlPlane !== true ? 'ai-chat-service' : 'proxy-adapter',
        'permission_denied',
        'semantic v1 控制面只允许 loopback 单用户部署',
        false
      );
    }
    if (agentFeatures.sideEffectAuthorization !== 'preauthorized_steps_only') {
      throw new IntegrationClientError(
        'ai-chat-service',
        'capability_mismatch',
        'ai-chat-service 未声明逐浏览器步骤副作用授权能力',
        false
      );
    }
    const sha256 = hashValue({ agent, browser });
    this.capabilitySnapshot = { checkedAt: now, sha256 };
    return sha256;
  }

  private enqueueSessionCreate(job: CoordinatorBrowserJob): void {
    this.options.evidence.enqueueOutbox({
      id: `browser-session-create:${job.id}:q${job.queueSeq}`,
      context: { type: job.contextType, id: job.contextId },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.create',
      endpointOrTool: '/api/v1/browser-execution/sessions',
      payloadRedacted: {
        browserJobId: job.id,
        viewport: { width: 1920, height: 1080 },
      },
    });
  }

  private enqueueSessionClose(job: CoordinatorBrowserJob, reason: string): void {
    if (!job.browserSessionId) throw new Error('活动 browser job 缺少 session ID');
    this.options.evidence.enqueueOutbox({
      id: `browser-session-close:${job.id}:q${job.queueSeq}`,
      context: { type: job.contextType, id: job.contextId },
      targetService: 'proxy_adapter',
      commandType: 'browser_session.close',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId',
      payloadRedacted: {
        browserJobId: job.id,
        browserSessionId: job.browserSessionId,
        reason,
      },
    });
  }

  private enqueueLeaseCreate(
    todo: ReturnType<SemanticCoordinatorRepository['getReadyTodo']> & {}
  ): void {
    if (!todo) return;
    const projection = buildRunTaskProjection(todo, `pending:${todo.todoId}`);
    this.options.evidence.enqueueOutbox({
      id: `browser-lease-create:${todo.todoId}:v${todo.todoStateVersion}`,
      context: { type: 'run', id: todo.runId },
      targetService: 'proxy_adapter',
      commandType: 'browser_lease.create',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId/leases',
      payloadRedacted: {
        runId: todo.runId,
        todoId: todo.todoId,
        todoStateVersion: todo.todoStateVersion,
        browserSessionId: todo.browserSessionId,
        operations: projection.operations,
      },
    });
  }

  private enqueueAuthoringLeaseCreate(task: CoordinatorAuthoringTask): void {
    const candidates = this.options.authoringCandidates;
    if (!candidates) {
      throw new Error('Authoring candidate coordinator is not configured');
    }
    const requirements = candidates.leaseRequirements(task);
    this.options.evidence.enqueueOutbox({
      id: `authoring-browser-lease-create:${task.taskId}`,
      context: { type: 'authoring', id: task.jobId },
      authoringTaskId: task.taskId,
      targetService: 'proxy_adapter',
      commandType: 'authoring_browser_lease.create',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId/leases',
      payloadRedacted: {
        authoringTaskId: task.taskId,
        browserSessionId: task.browserSessionId,
        mode: requirements.mode,
        operations: requirements.operations,
      },
    });
  }

  private async dispatchOutbox(item: OutboxItem, capabilitySha256: string): Promise<void> {
    try {
      switch (item.command_type) {
        case 'browser_session.create':
          await this.createBrowserSession(item, capabilitySha256);
          break;
        case 'browser_lease.create':
          await this.createBrowserLease(item);
          break;
        case 'agent_task.create':
          await this.createAgentTask(item);
          break;
        case 'authoring_browser_lease.create':
          await this.createAuthoringBrowserLease(item);
          break;
        case 'authoring_agent_task.create':
          await this.createAuthoringAgentTask(item);
          break;
        case 'agent_task.command':
          await this.commandAgentTask(item);
          break;
        case 'browser_lease.revoke':
          await this.revokeBrowserLease(item);
          break;
        case 'browser_session.close':
          await this.closeBrowserSession(item);
          break;
        default:
          throw new IntegrationClientError(
            item.target_service === 'ai_chat_service' ? 'ai-chat-service' : 'proxy-adapter',
            'unsupported_outbox_command',
            `协调器不支持 outbox 命令 '${item.command_type}'`,
            false
          );
      }
    } catch (error) {
      await this.handleDispatchFailure(item, error);
    }
  }

  private async createBrowserSession(item: OutboxItem, capabilitySha256: string): Promise<void> {
    const payload = payloadObject(item);
    const browserJobId = requiredString(payload.browserJobId, 'browserJobId');
    const session = await this.options.browser.createSession(item.id, {
      headless: false,
      viewport: { width: 1920, height: 1080 },
    });
    const job = this.options.repository.getActiveBrowserJob();
    if (!job || job.id !== browserJobId || job.state !== 'acquiring') {
      throw new Error('浏览器会话返回时 browser job 已不再处于 acquiring');
    }
    this.options.evidence.linkExternalTask({
      context: { type: job.contextType, id: job.contextId },
      service: 'proxy_adapter',
      kind: 'browser_session',
      externalId: session.id,
      externalState: session.status,
      requestSha256: String(item.request_sha256),
    });
    this.options.workflows.transitionBrowserJob(job.id, 'active', {
      browserSessionId: session.id,
      capabilitySnapshotSha256: capabilitySha256,
    });
    this.options.repository.attachBrowserSession(job, session.id);
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: session.id });
  }

  private async createBrowserLease(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const runId = requiredString(payload.runId, 'runId');
    const todoId = requiredString(payload.todoId, 'todoId');
    const sessionId = requiredString(payload.browserSessionId, 'browserSessionId');
    const operations = stringArray(payload.operations, 'operations');
    const runSession = this.options.repository.getRunBrowserSession(runId);
    const readyTodo = runSession ? this.options.repository.getReadyTodo(runSession.jobId) : null;
    if (!readyTodo || readyTodo.todoId !== todoId) {
      this.options.evidence.settleOutbox(item.id, 'cancelled', {
        error: { code: 'stale_todo', message: 'TODO 已不再处于可执行状态', retryable: false },
      });
      return;
    }
    const session = await this.options.browser.getSession(sessionId);
    const tab = session.tabs.find((candidate) => candidate.isActive) ?? session.tabs[0];
    if (!tab)
      throw new IntegrationClientError(
        'proxy-adapter',
        'browser_unavailable',
        '浏览器会话没有可用 Tab',
        true
      );
    const issued = await this.options.browser.createLease(sessionId, item.id, {
      mode: 'control',
      ttlSeconds: 300,
      tabIds: [tab.id],
      operations,
    });
    const secretRef = `coordinator-secret://browser-lease/${issued.lease.id}`;
    const leaseToken = issued.token ?? this.secrets.get(secretRef);
    if (!leaseToken) {
      const current = await this.options.browser.getSession(sessionId);
      const active = current.activeLeases.find((lease) => lease.id === issued.lease.id);
      if (active) {
        throw new IntegrationClientError(
          'proxy-adapter',
          'lease_token_unavailable',
          '幂等租约仍活动，但一次性 token 已在协调器崩溃时销毁',
          true,
          undefined,
          { nextAttemptAt: new Date(Date.parse(active.expiresAt) + 1_000).toISOString() }
        );
      }
      this.options.evidence.enqueueOutbox({
        id: `${item.id}:recovery:${issued.lease.sequence}`,
        context: { type: 'run', id: runId },
        targetService: 'proxy_adapter',
        commandType: 'browser_lease.create',
        endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId/leases',
        payloadRedacted: payload,
      });
      this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: issued.lease.id });
      return;
    }
    const tokenHash = sha256(leaseToken);
    this.secrets.put(secretRef, leaseToken);
    const todo = this.options.repository.getReadyTodo(runSession?.jobId ?? '');
    if (!todo || todo.todoId !== todoId) {
      await this.options.browser.revokeLease(
        sessionId,
        issued.lease.id,
        leaseToken,
        `${item.id}:stale`
      );
      this.secrets.delete(secretRef);
      throw new Error('租约签发后 TODO 已不再可执行');
    }
    const pageTaskId = randomUUID();
    const projection = buildRunTaskProjection(todo, pageTaskId);
    const started = this.options.runs.startTodo({
      pageTaskId,
      runId,
      todoId,
      browserSessionId: sessionId,
      tabId: tab.id,
      browserLeaseRefHash: tokenHash,
      toolPolicyHash: projection.toolPolicyHash,
      taskPayloadSha256: projection.taskPayloadSha256,
      requiredAuthContext: todo.authContext,
      sideEffectAuthorization: {
        policyEvaluationId: todo.policyEvaluationId ?? null,
        approvalGrantId: todo.approvalGrantId ?? null,
      },
      budget: projection.budget,
    });
    this.options.evidence.linkExternalTask({
      context: { type: 'run', id: runId },
      pageTaskId: started.pageTaskId,
      service: 'proxy_adapter',
      kind: 'browser_lease',
      externalId: issued.lease.id,
      externalState: issued.lease.status,
      requestSha256: String(item.request_sha256),
      tokenHash,
      secretRef,
    });
    this.options.evidence.enqueueOutbox({
      id: `agent-task-create:${started.pageTaskId}`,
      context: { type: 'run', id: runId },
      pageTaskId: started.pageTaskId,
      targetService: 'ai_chat_service',
      commandType: 'agent_task.create',
      endpointOrTool: '/api/v1/agent-tasks',
      payloadRedacted: {
        agentRequest: projection.agentRequest,
        browserBinding: {
          browserSessionId: sessionId,
          tabId: tab.id,
          browserLeaseId: issued.lease.id,
          browserLeaseSequence: issued.lease.sequence,
          access: 'control',
        },
      },
      secretBindingRef: secretRef,
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: issued.lease.id });
  }

  private async createAuthoringBrowserLease(item: OutboxItem): Promise<void> {
    const candidates = this.options.authoringCandidates;
    if (!candidates) throw new Error('Authoring candidate coordinator is not configured');
    const payload = payloadObject(item);
    const taskId = requiredString(payload.authoringTaskId, 'authoringTaskId');
    const sessionId = requiredString(payload.browserSessionId, 'browserSessionId');
    const task = this.options.repository.getAuthoringTask(item.context_id, 'ready');
    if (!task || task.taskId !== taskId) {
      this.options.evidence.settleOutbox(item.id, 'cancelled', {
        error: {
          code: 'stale_authoring_task',
          message: 'Authoring task 已不再可执行',
          retryable: false,
        },
      });
      return;
    }
    const session = await this.options.browser.getSession(sessionId);
    const tab = session.tabs.find((candidate) => candidate.isActive) ?? session.tabs[0];
    if (!tab)
      throw new IntegrationClientError(
        'proxy-adapter',
        'browser_unavailable',
        '浏览器会话没有可用 Tab',
        true
      );
    const requirements = candidates.leaseRequirements(task);
    const issued = await this.options.browser.createLease(sessionId, item.id, {
      mode: 'control',
      ttlSeconds: 300,
      tabIds: [tab.id],
      operations: requirements.operations,
    });
    const secretRef = `coordinator-secret://browser-lease/${issued.lease.id}`;
    const leaseToken = issued.token ?? this.secrets.get(secretRef);
    if (!leaseToken) {
      const current = await this.options.browser.getSession(sessionId);
      const active = current.activeLeases.find((lease) => lease.id === issued.lease.id);
      if (active) {
        throw new IntegrationClientError(
          'proxy-adapter',
          'lease_token_unavailable',
          'Authoring 租约的一次性 token 不可用',
          true,
          undefined,
          { nextAttemptAt: new Date(Date.parse(active.expiresAt) + 1_000).toISOString() }
        );
      }
      throw new IntegrationClientError(
        'proxy-adapter',
        'lease_token_unavailable',
        'Authoring 租约已失效',
        true
      );
    }
    this.secrets.put(secretRef, leaseToken);
    this.options.workflows.startAuthoringTask(taskId);
    this.options.evidence.linkExternalTask({
      context: { type: 'authoring', id: task.jobId },
      authoringTaskId: taskId,
      service: 'proxy_adapter',
      kind: 'browser_lease',
      externalId: issued.lease.id,
      externalState: issued.lease.status,
      requestSha256: String(item.request_sha256),
      tokenHash: sha256(leaseToken),
      secretRef,
    });
    const request = candidates.buildAgentRequest(task);
    this.options.evidence.enqueueOutbox({
      id: `authoring-agent-task-create:${taskId}`,
      context: { type: 'authoring', id: task.jobId },
      authoringTaskId: taskId,
      targetService: 'ai_chat_service',
      commandType: 'authoring_agent_task.create',
      endpointOrTool: '/api/v1/agent-tasks',
      payloadRedacted: {
        agentRequest: request,
        browserBinding: {
          browserSessionId: sessionId,
          tabId: tab.id,
          browserLeaseId: issued.lease.id,
          browserLeaseSequence: issued.lease.sequence,
          access: requirements.mode,
        },
      },
      secretBindingRef: secretRef,
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: issued.lease.id });
  }

  private async createAuthoringAgentTask(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const request = objectValue(payload.agentRequest) as unknown as Omit<
      CreateAgentTaskInput,
      'browserBinding'
    >;
    const binding = objectValue(payload.browserBinding);
    const secretRef = requiredString(item.secret_binding_ref, 'secretBindingRef');
    const token = this.secrets.get(secretRef);
    if (!token) {
      const current = this.options.repository.getAuthoringTask(item.context_id, 'running');
      if (current) {
        this.options.workflows.completeAuthoringAttempt({
          taskId: current.taskId,
          status: 'interrupted',
          error: { code: 'secret_binding_lost' },
          startedAt: current.startedAt ?? this.isoNow(),
        });
        this.options.workflows.settleAuthoringJob(current.jobId, 'failed', {
          code: 'secret_binding_lost',
        });
      }
      this.options.evidence.settleOutbox(item.id, 'terminal_failed', {
        error: {
          code: 'secret_binding_lost',
          message: 'Authoring 租约 secret 不可恢复',
          retryable: false,
        },
      });
      return;
    }
    const fullRequest: CreateAgentTaskInput = {
      ...request,
      browserBinding: {
        browserSessionId: requiredString(binding.browserSessionId, 'browserSessionId'),
        tabId: requiredString(binding.tabId, 'tabId'),
        browserLeaseId: requiredString(binding.browserLeaseId, 'browserLeaseId'),
        browserLeaseToken: token,
        browserLeaseSequence: requiredInteger(binding.browserLeaseSequence, 'browserLeaseSequence'),
        access: binding.access === 'control' ? 'control' : 'observe',
      },
    };
    const task = await this.options.agentTasks.createTask(fullRequest, item.id);
    const authoringTaskId = requiredString(item.authoring_task_id, 'authoringTaskId');
    this.options.evidence.linkExternalTask({
      context: { type: 'authoring', id: item.context_id },
      authoringTaskId,
      service: 'ai_chat_service',
      kind: 'agent_task',
      externalId: task.taskId,
      externalState: task.status,
      lastExternalSeq: task.eventSeq,
      requestSha256: String(item.request_sha256),
      terminal: TERMINAL_AGENT_STATES.has(task.status),
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: task.taskId });
  }

  private async createAgentTask(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const request = objectValue(payload.agentRequest) as unknown as Omit<
      CreateAgentTaskInput,
      'browserBinding'
    >;
    const binding = objectValue(payload.browserBinding);
    const secretRef = requiredString(item.secret_binding_ref, 'secretBindingRef');
    const token = this.secrets.get(secretRef);
    if (!token) {
      await this.interruptOrphanedPageTask(item, 'browser_lease_secret_lost');
      this.options.evidence.settleOutbox(item.id, 'terminal_failed', {
        error: {
          code: 'secret_binding_lost',
          message: '协调器重启后租约明文已销毁',
          retryable: false,
        },
      });
      return;
    }
    const fullRequest: CreateAgentTaskInput = {
      ...request,
      browserBinding: {
        browserSessionId: requiredString(binding.browserSessionId, 'browserSessionId'),
        tabId: requiredString(binding.tabId, 'tabId'),
        browserLeaseId: requiredString(binding.browserLeaseId, 'browserLeaseId'),
        browserLeaseToken: token,
        browserLeaseSequence: requiredInteger(binding.browserLeaseSequence, 'browserLeaseSequence'),
        access: binding.access === 'observe' ? 'observe' : 'control',
      },
    };
    const task = await this.options.agentTasks.createTask(fullRequest, item.id);
    const pageTaskId = requiredString(item.page_task_id, 'pageTaskId');
    this.options.repository.setPageTaskAgentTask(pageTaskId, task.taskId);
    this.options.evidence.linkExternalTask({
      context: { type: 'run', id: item.context_id },
      pageTaskId,
      service: 'ai_chat_service',
      kind: 'agent_task',
      externalId: task.taskId,
      externalState: task.status,
      lastExternalSeq: task.eventSeq,
      requestSha256: String(item.request_sha256),
      terminal: TERMINAL_AGENT_STATES.has(task.status),
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: task.taskId });
  }

  private async reconcilePageTask(pageTask: ActivePageTask): Promise<string | null> {
    const link = this.options.repository.getExternalLink(pageTask.pageTaskId, 'agent_task');
    if (!link) {
      const lease = this.options.repository.getExternalLink(pageTask.pageTaskId, 'browser_lease');
      if (lease?.secretRef && !this.secrets.has(lease.secretRef)) {
        await this.completeInterrupted(pageTask, 'browser_lease_secret_lost');
        return 'page_task.interrupted';
      }
      if (!lease) {
        await this.completeInterrupted(pageTask, 'coordinator_dispatch_interrupted');
        return 'page_task.interrupted';
      }
      return null;
    }
    const task = await this.options.agentTasks.getTask(link.externalId);
    this.options.evidence.linkExternalTask({
      context: { type: 'run', id: pageTask.runId },
      pageTaskId: pageTask.pageTaskId,
      service: 'ai_chat_service',
      kind: 'agent_task',
      externalId: task.taskId,
      externalState: task.status,
      lastExternalSeq: task.eventSeq,
      terminal: TERMINAL_AGENT_STATES.has(task.status),
      ...(task.output !== undefined ? { resultSha256: hashValue(task.output) } : {}),
    });
    if (!TERMINAL_AGENT_STATES.has(task.status)) {
      const desired = desiredAgentCommand(pageTask.runLifecycle, task.status);
      if (desired) {
        this.options.evidence.enqueueOutbox({
          id: `agent-task-command:${task.taskId}:${desired}:v${task.stateVersion}`,
          context: { type: 'run', id: pageTask.runId },
          pageTaskId: pageTask.pageTaskId,
          targetService: 'ai_chat_service',
          commandType: 'agent_task.command',
          endpointOrTool: '/api/v1/agent-tasks/:taskId/commands',
          payloadRedacted: {
            taskId: task.taskId,
            command: desired,
            expectedStateVersion: task.stateVersion,
          },
        });
        return `agent_task.${desired}_queued`;
      }
      return null;
    }
    const manifestId = await this.captureEvidence(pageTask, task);
    const completion = completionFromTask(task);
    this.options.runs.completeTodoAttempt({
      runId: pageTask.runId,
      todoId: pageTask.todoId,
      pageTaskId: pageTask.pageTaskId,
      result: completion.result,
      reasonClass: completion.reasonClass,
      agentTaskId: task.taskId,
      startedAt: task.startedAt ?? pageTask.startedAt,
      ...(completion.checkpoint ? { checkpoint: completion.checkpoint } : {}),
      ...(completion.actualPage ? { actualPage: completion.actualPage } : {}),
      ...(completion.confirmedOutputs ? { confirmedOutputs: completion.confirmedOutputs } : {}),
      ...(completion.partialOutputs ? { partialOutputs: completion.partialOutputs } : {}),
      ...(completion.sideEffects ? { sideEffects: completion.sideEffects } : {}),
      ...(completion.downstreamImpact ? { downstreamImpact: completion.downstreamImpact } : {}),
      ...(manifestId ? { evidenceManifestId: manifestId } : {}),
      ...(completion.result === 'outcome_unknown' || completion.result === 'decision_required'
        ? {
            decision: {
              category: completion.result,
              question:
                completion.result === 'outcome_unknown'
                  ? '该浏览器副作用是否已经发生？'
                  : '如何处理当前页面任务？',
              facts: { agentTaskId: task.taskId, summary: completion.summary },
              evidenceRefs: manifestId ? [manifestId] : [],
              options: [
                { key: 'resume', label: '核对后恢复' },
                { key: 'fail', label: '标记失败' },
                { key: 'cancel', label: '取消运行' },
              ],
              recommendationKey: 'resume',
              impact: { todoId: pageTask.todoId },
            },
          }
        : {}),
    });
    if (TERMINAL_RUN_STATES.has(this.options.repository.getRunLifecycle(pageTask.runId) ?? '')) {
      this.enqueueSessionCloseWithLease({
        contextType: 'run',
        contextId: pageTask.runId,
        sessionId: pageTask.browserSessionId,
        lease: this.options.repository.getExternalLink(pageTask.pageTaskId, 'browser_lease'),
        pageTaskId: pageTask.pageTaskId,
      });
    } else {
      this.enqueueLeaseRevoke(pageTask);
    }
    return `agent_task.${task.status}_applied`;
  }

  private async reconcileAuthoringTask(task: CoordinatorAuthoringTask): Promise<string | null> {
    const candidates = this.options.authoringCandidates;
    if (!candidates) throw new Error('Authoring candidate coordinator is not configured');
    const link = this.options.repository.getAuthoringExternalLink(task.taskId, 'agent_task');
    if (!link) {
      const lease = this.options.repository.getAuthoringExternalLink(task.taskId, 'browser_lease');
      if (!lease) {
        this.options.workflows.completeAuthoringAttempt({
          taskId: task.taskId,
          status: 'interrupted',
          error: { code: 'coordinator_dispatch_interrupted' },
          startedAt: task.startedAt ?? this.isoNow(),
        });
        this.options.workflows.settleAuthoringJob(task.jobId, 'failed', {
          code: 'coordinator_dispatch_interrupted',
        });
        return 'authoring_task.interrupted';
      }
      return null;
    }
    const agentTask = await this.options.agentTasks.getTask(link.externalId);
    this.options.evidence.linkExternalTask({
      context: { type: 'authoring', id: task.jobId },
      authoringTaskId: task.taskId,
      service: 'ai_chat_service',
      kind: 'agent_task',
      externalId: agentTask.taskId,
      externalState: agentTask.status,
      lastExternalSeq: agentTask.eventSeq,
      terminal: TERMINAL_AGENT_STATES.has(agentTask.status),
      ...(agentTask.output !== undefined ? { resultSha256: hashValue(agentTask.output) } : {}),
    });
    if (!TERMINAL_AGENT_STATES.has(agentTask.status)) return null;
    const manifestId = await this.captureAuthoringEvidence(task, agentTask);
    if (task.targetType === 'authoring_amendment') {
      try {
        const verification = candidates.applyVerificationOutput(task, agentTask);
        this.options.workflows.completeAuthoringAttempt({
          taskId: task.taskId,
          status: verification.status === 'activated' ? 'succeeded' : 'failed',
          agentTaskId: agentTask.taskId,
          result: {
            status: verification.status,
            summary: verification.summary,
            amendmentId: verification.amendment.id,
          },
          evidenceManifestId: manifestId,
          startedAt: agentTask.startedAt ?? task.startedAt ?? this.isoNow(),
        });
        this.options.workflows.settleAuthoringJob(
          task.jobId,
          verification.status === 'activated' ? 'completed' : 'failed',
          {
            status: verification.status,
            summary: verification.summary,
            amendmentId: verification.amendment.id,
          }
        );
        this.enqueueAuthoringSessionClose(task);
        return `authoring_verification.${verification.status}`;
      } catch (error) {
        this.options.workflows.completeAuthoringAttempt({
          taskId: task.taskId,
          status: 'failed',
          agentTaskId: agentTask.taskId,
          evidenceManifestId: manifestId,
          error: {
            code: 'verification_application_failed',
            message: error instanceof Error ? error.message : '验证结果应用失败',
          },
          startedAt: agentTask.startedAt ?? task.startedAt ?? this.isoNow(),
        });
        this.options.workflows.settleAuthoringJob(task.jobId, 'failed', {
          code: 'verification_application_failed',
          message: error instanceof Error ? error.message : '验证结果应用失败',
        });
        this.enqueueAuthoringSessionClose(task);
        return 'authoring_verification.failed';
      }
    }
    let result: ReturnType<SemanticAuthoringCandidateService['applyAgentOutput']>;
    try {
      result = candidates.applyAgentOutput(task, agentTask);
    } catch (error) {
      this.options.workflows.completeAuthoringAttempt({
        taskId: task.taskId,
        status: 'failed',
        agentTaskId: agentTask.taskId,
        evidenceManifestId: manifestId,
        error: {
          code: 'candidate_validation_failed',
          message: error instanceof Error ? error.message : '候选校验失败',
        },
        startedAt: agentTask.startedAt ?? task.startedAt ?? this.isoNow(),
      });
      this.options.workflows.settleAuthoringJob(task.jobId, 'failed', {
        code: 'candidate_validation_failed',
        message: error instanceof Error ? error.message : '候选校验失败',
      });
      this.enqueueAuthoringSessionClose(task);
      return 'authoring_candidate.failed';
    }
    this.options.workflows.completeAuthoringAttempt({
      taskId: task.taskId,
      status: result.status === 'blocked' ? 'blocked' : 'succeeded',
      agentTaskId: agentTask.taskId,
      ...(result.firstCandidate
        ? {
            candidateAssetType: result.firstCandidate.assetType,
            candidateAssetId: result.firstCandidate.assetId,
            candidateRevisionId: result.firstCandidate.revisionId,
          }
        : {}),
      result: {
        status: result.status,
        summary: result.summary,
        amendmentId: result.amendment?.id ?? null,
        amendmentState: result.amendment?.state ?? null,
      },
      evidenceManifestId: manifestId,
      startedAt: agentTask.startedAt ?? task.startedAt ?? this.isoNow(),
    });
    if (result.status === 'candidate_ready') {
      this.options.workflows.settleAuthoringJob(
        task.jobId,
        result.amendment?.state === 'waiting_decision' ? 'waiting_decision' : 'paused',
        {
          status: result.status,
          amendmentId: result.amendment?.id,
          amendmentState: result.amendment?.state,
          summary: result.summary,
        }
      );
    } else if (result.status === 'no_change') {
      this.options.workflows.settleAuthoringJob(task.jobId, 'completed', {
        status: result.status,
        summary: result.summary,
      });
    } else {
      this.options.workflows.settleAuthoringJob(task.jobId, 'failed', {
        status: result.status,
        summary: result.summary,
      });
    }
    this.enqueueAuthoringSessionClose(task);
    return `authoring_candidate.${result.status}`;
  }

  private async captureAuthoringEvidence(
    task: CoordinatorAuthoringTask,
    agentTask: AgentTaskView
  ): Promise<string> {
    const manifest = this.options.evidence.createManifest({
      context: { type: 'authoring', id: task.jobId },
      schemaId: 'nebula.ai-e2e.evidence-manifest/1.0',
      retentionClass: agentTask.status === 'completed' ? 'success_7d' : 'failure_30d',
    });
    const audit = {
      taskId: agentTask.taskId,
      authoringTaskId: task.taskId,
      status: agentTask.status,
      terminationReason: agentTask.terminationReason ?? null,
      toolCalls: agentTask.toolCalls,
      error: agentTask.error ?? null,
    };
    this.options.evidence.addItem({
      manifestId: manifest.id,
      itemType: 'agent_audit',
      inline: audit,
      sourceService: 'ai-chat-service',
      redactionStatus: 'not_required',
      integritySha256: hashValue(audit),
      metadata: { authoringTaskId: task.taskId },
    });
    let partial = false;
    for (const call of agentTask.toolCalls) {
      if (!call.operationId) continue;
      try {
        const operation = await this.options.browser.getOperation(call.operationId);
        const summary = operationSummary(operation);
        this.options.evidence.linkExternalTask({
          context: { type: 'authoring', id: task.jobId },
          authoringTaskId: task.taskId,
          service: 'proxy_adapter',
          kind: 'browser_operation',
          externalId: operation.operationId,
          externalState: operation.status,
          resultSha256: hashValue(summary),
          terminal: true,
        });
        this.options.evidence.addItem({
          manifestId: manifest.id,
          itemType: 'operation_result',
          inline: summary,
          stepId: call.stepId,
          browserOperationId: operation.operationId,
          sourceService: 'proxy-adapter',
          redactionStatus: 'not_required',
          integritySha256: hashValue(summary),
          metadata: { toolCallId: call.toolCallId },
        });
        for (const artifact of operation.artifacts) {
          const bytes = await this.options.browser.downloadArtifact(
            task.browserSessionId,
            artifact.id
          );
          const persisted = await this.artifactStore.persist(artifact.sha256, bytes);
          const registered = this.options.evidence.registerArtifact({
            sha256: artifact.sha256,
            sizeBytes: persisted.sizeBytes,
            mediaType: artifact.mimeType,
            storageBackend: 'local_file',
            storageKey: persisted.storageKey,
            sensitivity: 'sensitive',
            redactionStatus: 'pending',
          });
          this.options.evidence.linkExternalTask({
            context: { type: 'authoring', id: task.jobId },
            authoringTaskId: task.taskId,
            service: 'proxy_adapter',
            kind: 'artifact',
            externalId: artifact.id,
            resultSha256: artifact.sha256,
            resultRef: registered.id,
            terminal: true,
          });
          this.options.evidence.addItem({
            manifestId: manifest.id,
            itemType: artifact.kind === 'dom_snapshot' ? 'dom_snapshot' : 'screenshot',
            artifactObjectId: registered.id,
            stepId: call.stepId,
            browserOperationId: operation.operationId,
            sourceService: 'proxy-adapter',
            redactionStatus: 'pending',
            integritySha256: artifact.sha256,
            metadata: { externalArtifactId: artifact.id, captureKind: artifact.kind },
          });
        }
      } catch (error) {
        partial = true;
        this.options.logger?.warn(
          { err: error, operationId: call.operationId },
          'Authoring 浏览器证据收集不完整'
        );
      }
    }
    this.options.evidence.sealManifest(manifest.id, partial ? 'partial' : 'complete', {
      agentTaskId: agentTask.taskId,
      taskStatus: agentTask.status,
    });
    return manifest.id;
  }

  private enqueueAuthoringSessionClose(task: CoordinatorAuthoringTask): void {
    const lease = this.options.repository.getAuthoringExternalLink(task.taskId, 'browser_lease');
    if (!lease) return;
    this.enqueueSessionCloseWithLease({
      contextType: 'authoring',
      contextId: task.jobId,
      sessionId: task.browserSessionId,
      lease,
      authoringTaskId: task.taskId,
    });
  }

  private enqueueSessionCloseWithLease(input: {
    contextType: 'run' | 'authoring';
    contextId: string;
    sessionId: string;
    lease: { externalId: string; secretRef?: string } | null;
    pageTaskId?: string;
    authoringTaskId?: string;
  }): void {
    if (!input.lease?.secretRef) return;
    this.options.evidence.enqueueOutbox({
      id: `browser-session-close:${input.lease.externalId}`,
      context: { type: input.contextType, id: input.contextId },
      ...(input.pageTaskId ? { pageTaskId: input.pageTaskId } : {}),
      ...(input.authoringTaskId ? { authoringTaskId: input.authoringTaskId } : {}),
      targetService: 'proxy_adapter',
      commandType: 'browser_session.close',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId',
      payloadRedacted: {
        browserSessionId: input.sessionId,
        browserLeaseId: input.lease.externalId,
        reason: `${input.contextType}_terminal`,
      },
      secretBindingRef: input.lease.secretRef,
    });
  }

  private async commandAgentTask(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const taskId = requiredString(payload.taskId, 'taskId');
    const command = requiredString(payload.command, 'command') as 'pause' | 'resume' | 'cancel';
    const result = await this.options.agentTasks.commandTask(taskId, {
      commandId: item.id,
      type: command,
      expectedStateVersion: requiredInteger(payload.expectedStateVersion, 'expectedStateVersion'),
      reason: 'ai-e2e 权威运行状态同步',
      createdBy: 'semantic-coordinator',
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: result.task.taskId });
  }

  private enqueueLeaseRevoke(pageTask: ActivePageTask): void {
    const lease = this.options.repository.getExternalLink(pageTask.pageTaskId, 'browser_lease');
    if (!lease) return;
    this.options.evidence.enqueueOutbox({
      id: `browser-lease-revoke:${lease.externalId}`,
      context: { type: 'run', id: pageTask.runId },
      pageTaskId: pageTask.pageTaskId,
      targetService: 'proxy_adapter',
      commandType: 'browser_lease.revoke',
      endpointOrTool: '/api/v1/browser-execution/sessions/:sessionId/leases/:leaseId',
      payloadRedacted: {
        browserSessionId: pageTask.browserSessionId,
        browserLeaseId: lease.externalId,
      },
      ...(lease.secretRef ? { secretBindingRef: lease.secretRef } : {}),
    });
  }

  private async revokeBrowserLease(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const sessionId = requiredString(payload.browserSessionId, 'browserSessionId');
    const leaseId = requiredString(payload.browserLeaseId, 'browserLeaseId');
    const secretRef = item.secret_binding_ref ? String(item.secret_binding_ref) : undefined;
    const token = secretRef ? this.secrets.get(secretRef) : undefined;
    if (!token) {
      const session = await this.options.browser.getSession(sessionId);
      if (!session.activeLeases.some((lease) => lease.id === leaseId)) {
        this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: leaseId });
        return;
      }
      throw new IntegrationClientError(
        'proxy-adapter',
        'lease_token_unavailable',
        '租约仍活动但协调器已无明文 token，等待租约过期后核对',
        true
      );
    }
    let lease: Awaited<ReturnType<SemanticBrowserClientPort['revokeLease']>>;
    try {
      lease = await this.options.browser.revokeLease(sessionId, leaseId, token, item.id);
    } catch (error) {
      if (!(error instanceof IntegrationClientError) || error.code !== 'lease_expired') throw error;
      const session = await this.options.browser.getSession(sessionId);
      if (session.activeLeases.some((active) => active.id === leaseId)) throw error;
      if (secretRef) this.secrets.delete(secretRef);
      this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: leaseId });
      return;
    }
    if (secretRef) this.secrets.delete(secretRef);
    this.options.evidence.linkExternalTask({
      context: { type: item.context_type, id: item.context_id },
      ...(item.page_task_id ? { pageTaskId: String(item.page_task_id) } : {}),
      ...(item.authoring_task_id ? { authoringTaskId: String(item.authoring_task_id) } : {}),
      service: 'proxy_adapter',
      kind: 'browser_lease',
      externalId: lease.id,
      externalState: lease.status,
      terminal: true,
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: lease.id });
  }

  private async closeBrowserSession(item: OutboxItem): Promise<void> {
    const payload = payloadObject(item);
    const runSession =
      item.context_type === 'run'
        ? this.options.repository.getRunBrowserSession(item.context_id)
        : null;
    const sessionId = stringValue(payload.browserSessionId) ?? runSession?.sessionId;
    if (!sessionId) throw new Error('关闭浏览器命令找不到关联 session');
    const session = await this.options.browser.getSession(sessionId).catch((error) => {
      if (error instanceof IntegrationClientError && error.statusCode === 404) return null;
      throw error;
    });
    if (session && session.status !== 'closed') {
      const leaseId = stringValue(payload.browserLeaseId);
      const secretRef = item.secret_binding_ref ? String(item.secret_binding_ref) : undefined;
      const leaseToken = secretRef ? this.secrets.get(secretRef) : undefined;
      if (!leaseId || !leaseToken || !session.activeLeases.some((lease) => lease.id === leaseId)) {
        throw new IntegrationClientError(
          'proxy-adapter',
          'lease_conflict',
          '关闭浏览器需要关联的活动控制租约',
          false
        );
      }
      await this.options.browser.closeSession(sessionId, item.id, { leaseId, leaseToken });
      this.secrets.delete(secretRef!);
    }
    const job = this.options.repository.getActiveBrowserJob();
    if (job && job.contextType === item.context_type && job.contextId === item.context_id) {
      if (job.state === 'active') this.options.workflows.transitionBrowserJob(job.id, 'releasing');
      this.options.workflows.transitionBrowserJob(job.id, 'completed');
    }
    this.options.evidence.linkExternalTask({
      context: { type: item.context_type, id: item.context_id },
      service: 'proxy_adapter',
      kind: 'browser_session',
      externalId: sessionId,
      externalState: 'closed',
      terminal: true,
    });
    this.options.evidence.settleOutbox(item.id, 'confirmed', { resultRef: sessionId });
  }

  private async captureEvidence(
    pageTask: ActivePageTask,
    task: AgentTaskView
  ): Promise<string | undefined> {
    const manifest = this.options.evidence.createManifest({
      context: { type: 'run', id: pageTask.runId },
      todoId: pageTask.todoId,
      schemaId: 'nebula.ai-e2e.evidence-manifest/1.0',
      retentionClass: task.status === 'completed' ? 'success_7d' : 'failure_30d',
    });
    let partial = false;
    for (const call of task.toolCalls) {
      if (!call.operationId) continue;
      try {
        const operation = await this.options.browser.getOperation(call.operationId);
        this.linkOperation(pageTask, operation);
        this.options.evidence.addItem({
          manifestId: manifest.id,
          itemType: 'operation_result',
          inline: operationSummary(operation),
          stepId: call.stepId,
          browserOperationId: operation.operationId,
          sourceService: 'proxy-adapter',
          redactionStatus: 'not_required',
          integritySha256: hashValue(operationSummary(operation)),
          metadata: { toolCallId: call.toolCallId },
        });
        for (const artifact of operation.artifacts) {
          const bytes = await this.options.browser.downloadArtifact(
            pageTask.browserSessionId,
            artifact.id
          );
          const persisted = await this.artifactStore.persist(artifact.sha256, bytes);
          const registered = this.options.evidence.registerArtifact({
            sha256: artifact.sha256,
            sizeBytes: persisted.sizeBytes,
            mediaType: artifact.mimeType,
            storageBackend: 'local_file',
            storageKey: persisted.storageKey,
            sensitivity: 'sensitive',
            redactionStatus: 'pending',
          });
          this.options.evidence.linkExternalTask({
            context: { type: 'run', id: pageTask.runId },
            pageTaskId: pageTask.pageTaskId,
            service: 'proxy_adapter',
            kind: 'artifact',
            externalId: artifact.id,
            resultSha256: artifact.sha256,
            resultRef: registered.id,
            terminal: true,
          });
          this.options.evidence.addItem({
            manifestId: manifest.id,
            itemType: artifact.kind === 'dom_snapshot' ? 'dom_snapshot' : 'screenshot',
            artifactObjectId: registered.id,
            stepId: call.stepId,
            browserOperationId: operation.operationId,
            sourceService: 'proxy-adapter',
            redactionStatus: 'pending',
            integritySha256: artifact.sha256,
            metadata: { externalArtifactId: artifact.id, captureKind: artifact.kind },
          });
        }
      } catch (error) {
        partial = true;
        this.options.logger?.warn(
          { err: error, operationId: call.operationId },
          '浏览器证据收集不完整'
        );
      }
    }
    const audit = {
      taskId: task.taskId,
      status: task.status,
      terminationReason: task.terminationReason ?? null,
      toolCalls: task.toolCalls,
      error: task.error ?? null,
    };
    this.options.evidence.addItem({
      manifestId: manifest.id,
      itemType: 'agent_audit',
      inline: audit,
      sourceService: 'ai-chat-service',
      redactionStatus: 'not_required',
      integritySha256: hashValue(audit),
      metadata: { pageTaskId: pageTask.pageTaskId },
    });
    this.options.evidence.sealManifest(manifest.id, partial ? 'partial' : 'complete', {
      agentTaskId: task.taskId,
      taskStatus: task.status,
      operationCount: task.toolCalls.filter((call) => call.operationId).length,
    });
    return manifest.id;
  }

  private linkOperation(pageTask: ActivePageTask, operation: BrowserOperationRecord): void {
    this.options.evidence.linkExternalTask({
      context: { type: 'run', id: pageTask.runId },
      pageTaskId: pageTask.pageTaskId,
      service: 'proxy_adapter',
      kind: 'browser_operation',
      externalId: operation.operationId,
      externalState: operation.status,
      resultSha256: hashValue(operationSummary(operation)),
      terminal: ['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(operation.status),
    });
  }

  private async completeInterrupted(pageTask: ActivePageTask, reasonClass: string): Promise<void> {
    this.options.runs.completeTodoAttempt({
      runId: pageTask.runId,
      todoId: pageTask.todoId,
      pageTaskId: pageTask.pageTaskId,
      result: 'recoverable_interruption',
      reasonClass,
      agentTaskId: pageTask.aiTaskId ?? `coordinator-recovery:${pageTask.pageTaskId}`,
      startedAt: pageTask.startedAt,
      checkpoint: { recoverable: true, reasonClass },
    });
    this.enqueueLeaseRevoke(pageTask);
  }

  private async interruptOrphanedPageTask(item: OutboxItem, reasonClass: string): Promise<void> {
    if (!item.page_task_id) return;
    const job = this.options.repository.getActiveBrowserJob();
    const pageTask = job ? this.options.repository.getActivePageTask(job.id) : null;
    if (pageTask?.pageTaskId === item.page_task_id)
      await this.completeInterrupted(pageTask, reasonClass);
  }

  private async handleDispatchFailure(item: OutboxItem, error: unknown): Promise<void> {
    const integration = error instanceof IntegrationClientError ? error : undefined;
    const retryable = integration?.retryable ?? false;
    const attempts = Number(item.attempt_count ?? 1);
    const details = {
      code: integration?.code ?? 'coordinator_failure',
      message: error instanceof Error ? error.message : '协调器派发失败',
      retryable,
      service: integration?.service ?? null,
    };
    const retryAt = integration?.details?.nextAttemptAt;
    if (retryable && (attempts < 8 || integration?.code === 'lease_token_unavailable')) {
      const delayMs = Math.min(30_000, 500 * 2 ** Math.min(attempts - 1, 6));
      this.options.evidence.settleOutbox(item.id, 'retryable_failed', {
        error: details,
        nextAttemptAt:
          typeof retryAt === 'string'
            ? retryAt
            : new Date(this.now().getTime() + delayMs).toISOString(),
      });
      return;
    }
    this.options.evidence.settleOutbox(item.id, 'terminal_failed', { error: details });
    if (item.context_type === 'run') {
      this.options.repository.pauseRunForCoordinator(item.context_id, details);
    }
    if (item.command_type === 'browser_session.create') {
      const job = this.options.repository.getActiveBrowserJob();
      if (job?.state === 'acquiring' && job.contextId === item.context_id) {
        this.options.workflows.transitionBrowserJob(job.id, 'failed', { error: details });
      }
    }
    this.options.logger?.error({ err: error, outboxId: item.id }, '协调器命令终止失败');
  }

  private isoNow(): string {
    return this.now().toISOString();
  }
}

function mapClaimedJob(row: Record<string, unknown>): CoordinatorBrowserJob {
  return {
    id: String(row.id),
    queueSeq: Number(row.queue_seq),
    contextType: row.root_context_type as 'run' | 'authoring',
    contextId: String(row.root_context_id),
    state: 'acquiring',
    ...(row.browser_session_id ? { browserSessionId: String(row.browser_session_id) } : {}),
  };
}

function desiredAgentCommand(
  runLifecycle: string,
  agentStatus: string
): 'pause' | 'resume' | 'cancel' | null {
  if (runLifecycle === 'cancelling' && !TERMINAL_AGENT_STATES.has(agentStatus)) return 'cancel';
  if (runLifecycle === 'paused' && agentStatus === 'running') return 'pause';
  if (runLifecycle === 'running' && agentStatus === 'paused') return 'resume';
  return null;
}

function completionFromTask(task: AgentTaskView): {
  result:
    | 'succeeded'
    | 'assertion_failed'
    | 'execution_failed'
    | 'precondition_blocked'
    | 'recoverable_interruption'
    | 'decision_required'
    | 'outcome_unknown'
    | 'cancelled';
  reasonClass: string;
  summary: string;
  checkpoint?: Record<string, unknown>;
  actualPage?: Record<string, unknown>;
  confirmedOutputs?: Record<string, unknown>;
  partialOutputs?: Record<string, unknown>;
  sideEffects?: Record<string, unknown>;
  downstreamImpact?: Record<string, unknown>;
} {
  if (task.status === 'interrupted') {
    return {
      result: 'recoverable_interruption',
      reasonClass: task.error?.code ?? 'agent_interrupted',
      summary: task.error?.message ?? 'Agent task interrupted',
    };
  }
  if (task.status === 'cancelled')
    return { result: 'cancelled', reasonClass: 'run_cancelled', summary: 'Agent task cancelled' };
  if (task.status === 'blocked')
    return {
      result: 'precondition_blocked',
      reasonClass: task.error?.code ?? 'agent_blocked',
      summary: task.error?.message ?? 'Agent task blocked',
    };
  if (task.status === 'failed') {
    const unknown = task.toolCalls.some((call) => call.status === 'outcome_unknown');
    return {
      result: unknown ? 'outcome_unknown' : 'execution_failed',
      reasonClass: task.error?.code ?? (unknown ? 'browser_outcome_unknown' : 'agent_failed'),
      summary: task.error?.message ?? 'Agent task failed',
    };
  }
  const output = objectValue(task.output);
  const allowed = new Set([
    'succeeded',
    'assertion_failed',
    'execution_failed',
    'precondition_blocked',
    'decision_required',
    'outcome_unknown',
  ]);
  const result =
    typeof output.result === 'string' && allowed.has(output.result)
      ? (output.result as
          | 'succeeded'
          | 'assertion_failed'
          | 'execution_failed'
          | 'precondition_blocked'
          | 'decision_required'
          | 'outcome_unknown')
      : 'execution_failed';
  return {
    result,
    reasonClass: stringValue(output.reasonClass) ?? 'invalid_agent_output',
    summary: stringValue(output.summary) ?? 'Agent task returned an invalid result',
    ...optionalJsonObject(output.checkpointJson, 'checkpoint'),
    ...optionalJsonObject(output.actualPageJson, 'actualPage'),
    ...optionalJsonObject(output.confirmedOutputsJson, 'confirmedOutputs'),
    ...optionalJsonObject(output.partialOutputsJson, 'partialOutputs'),
    ...optionalJsonObject(output.sideEffectsJson, 'sideEffects'),
    ...optionalJsonObject(output.downstreamImpactJson, 'downstreamImpact'),
  };
}

function optionalJsonObject(value: unknown, key: string): Record<string, Record<string, unknown>> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { [key]: parsed as Record<string, unknown> }
      : {};
  } catch {
    return {};
  }
}

function operationSummary(operation: BrowserOperationRecord): Record<string, unknown> {
  return {
    operationId: operation.operationId,
    sessionId: operation.sessionId,
    tabId: operation.tabId ?? null,
    kind: operation.kind,
    operation: operation.operation,
    status: operation.status,
    artifacts: operation.artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      sha256: artifact.sha256,
      mimeType: artifact.mimeType,
    })),
    error: operation.error
      ? {
          code: operation.error.code,
          message: operation.error.message,
          retryable: operation.error.retryable,
        }
      : null,
  };
}

function requireCapability(
  value: Record<string, unknown>,
  service: string,
  protocol: string
): void {
  if (value.schema !== 'nebula.service-capabilities/1.0' || value.service !== service) {
    throw new IntegrationClientError(
      service === 'ai-chat-service' ? 'ai-chat-service' : 'proxy-adapter',
      'capability_mismatch',
      `${service} capability 信封不兼容`,
      false
    );
  }
  const selected = objectValue(objectValue(value.protocols)[protocol]);
  if (selected.major !== 1) {
    throw new IntegrationClientError(
      service === 'ai-chat-service' ? 'ai-chat-service' : 'proxy-adapter',
      'capability_mismatch',
      `${service} 未声明 ${protocol} major 1`,
      false
    );
  }
}

function payloadObject(item: OutboxItem): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(item.payload_json_redacted));
  } catch {
    throw new Error(`Outbox '${item.id}' payload 不是有效 JSON`);
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`${label} is required`);
  return value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer`);
  return value as number;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
