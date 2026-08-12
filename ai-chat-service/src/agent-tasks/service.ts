import { createHash, randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { AgentTaskError, toAgentTaskError } from './errors.js';
import type { AgentTaskExecutor, AgentTaskStatus, AgentTaskView } from './types.js';
import { validateCreateAgentTaskRequest } from './validation.js';
import type { AgentTaskRepository } from './repository.js';
import type {
  AgentTaskCommandRecord,
  AgentTaskEventRecord,
  AgentTaskCheckpointRecord,
} from './repository.js';

export interface CreateAgentTaskOptions {
  idempotencyKey?: string;
}

export interface CreateAgentTaskResult {
  task: AgentTaskView;
  created: boolean;
}

export interface AgentTaskCommandRequest {
  commandId: string;
  type: AgentTaskCommandRecord['type'];
  expectedStateVersion: number;
  reason?: string;
  createdBy?: string;
}

export interface AgentTaskCommandResult {
  command: AgentTaskCommandRecord;
  task: AgentTaskView;
}

export class AgentTaskService {
  private readonly activeRequests = new Map<
    string,
    ReturnType<typeof validateCreateAgentTaskRequest>['request']
  >();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Set<Promise<void>>();
  private readonly taskRuns = new Map<string, Promise<void>>();
  private readonly commandRuns = new Map<
    string,
    { requestHash: string; run: Promise<AgentTaskCommandResult> }
  >();
  private readonly toolCallsStarted = new Map<string, number>();
  private readonly controlActions = new Map<string, AgentTaskCommandRecord['type']>();
  private closing = false;

  constructor(
    private readonly repository: AgentTaskRepository,
    private readonly executor: AgentTaskExecutor,
    private readonly logger: Pick<Logger, 'info' | 'warn' | 'error'>
  ) {}

  recoverUnfinished(): number {
    return this.repository.recoverUnfinished();
  }

  create(rawRequest: unknown, options: CreateAgentTaskOptions = {}): CreateAgentTaskResult {
    if (this.closing)
      throw new AgentTaskError(
        'dependency_unavailable',
        'Agent task service is shutting down',
        true
      );
    if (
      options.idempotencyKey !== undefined &&
      (options.idempotencyKey.length < 1 || options.idempotencyKey.length > 200)
    ) {
      throw new AgentTaskError(
        'validation_failed',
        'Idempotency-Key must contain between 1 and 200 characters'
      );
    }
    const validated = validateCreateAgentTaskRequest(rawRequest);
    const taskId = randomUUID();
    const stored = this.repository.createOrGet({
      taskId,
      request: validated.persistedRequest,
      requestHash: validated.requestHash,
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
    });
    if (stored.created) {
      this.activeRequests.set(taskId, validated.request);
      this.toolCallsStarted.set(taskId, 0);
      this.schedule(taskId);
    }
    return stored;
  }

  get(taskId: string): AgentTaskView {
    const task = this.repository.get(taskId);
    if (!task) throw new AgentTaskError('not_found', `Agent task ${taskId} was not found`);
    return task;
  }

  listEvents(taskId: string, afterSeq = 0, limit = 100): AgentTaskEventRecord[] {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
      throw new AgentTaskError('validation_failed', 'afterSeq must be a non-negative integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new AgentTaskError('validation_failed', 'limit must be between 1 and 1000');
    }
    return this.repository.listEvents(taskId, afterSeq, limit);
  }

  getSnapshot(taskId: string): {
    type: 'agent_task.snapshot';
    seq: number;
    stateVersion: number;
    task: AgentTaskView;
    checkpoint?: AgentTaskCheckpointRecord;
  } {
    const task = this.get(taskId);
    const checkpoint = this.repository.getLatestCheckpoint(taskId);
    return {
      type: 'agent_task.snapshot',
      seq: task.eventSeq,
      stateVersion: task.stateVersion,
      task,
      ...(checkpoint ? { checkpoint } : {}),
    };
  }

  subscribeEvents(taskId: string, listener: (event: AgentTaskEventRecord) => void): () => void {
    return this.repository.subscribeEvents(taskId, listener);
  }

  command(taskId: string, raw: unknown): Promise<AgentTaskCommandResult> {
    const request = validateCommandRequest(raw);
    const requestHash = hashCommandRequest(taskId, request);
    const inFlight = this.commandRuns.get(request.commandId);
    if (inFlight) {
      if (inFlight.requestHash !== requestHash) {
        throw new AgentTaskError('conflict', 'Agent command id is already in use');
      }
      return inFlight.run;
    }
    const run = this.applyCommand(taskId, request, requestHash);
    this.commandRuns.set(request.commandId, { requestHash, run });
    void run.then(
      () => this.commandRuns.delete(request.commandId),
      () => this.commandRuns.delete(request.commandId)
    );
    return run;
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.runs);
    this.activeRequests.clear();
    this.repository.close();
  }

  private schedule(taskId: string): void {
    if (this.taskRuns.has(taskId)) {
      throw new AgentTaskError('conflict', `Agent task ${taskId} is already running`);
    }
    const run = new Promise<void>((resolve) => {
      setImmediate(() => void this.run(taskId).finally(resolve));
    });
    this.runs.add(run);
    this.taskRuns.set(taskId, run);
    void run.finally(() => {
      this.runs.delete(run);
      if (this.taskRuns.get(taskId) === run) this.taskRuns.delete(taskId);
    });
  }

  private async run(taskId: string): Promise<void> {
    const request = this.activeRequests.get(taskId);
    if (!request) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.budgets.maxDurationMs);
    timeout.unref();
    this.controllers.set(taskId, controller);
    const running = this.repository.markRunning(taskId);
    if (running.status !== 'running') return;
    this.logger.info({ taskId, clientTaskId: request.clientTaskId }, 'Agent task started');
    try {
      const result = await this.executor.execute({
        taskId,
        request,
        deadlineAt: Date.now() + request.budgets.maxDurationMs,
        signal: controller.signal,
        beforeToolCall: () => {
          if (controller.signal.aborted || this.repository.get(taskId)?.status !== 'running') {
            throw new AgentTaskError('conflict', 'Agent task is not at a runnable tool boundary');
          }
          this.toolCallsStarted.set(taskId, (this.toolCallsStarted.get(taskId) ?? 0) + 1);
        },
        emitEvent: (type, payload) => {
          this.repository.appendEvent(taskId, type, payload);
        },
      });
      if (this.controlActions.has(taskId) || this.repository.get(taskId)?.status !== 'running') {
        return;
      }
      this.repository.complete(taskId, result);
      this.logger.info(
        { taskId, terminationReason: result.terminationReason },
        'Agent task completed'
      );
    } catch (error) {
      if (this.controlActions.has(taskId)) return;
      if (this.closing) {
        this.repository.fail(taskId, 'interrupted', {
          code: 'service_shutdown',
          message: 'Agent task was interrupted because ai-chat-service is shutting down',
          retryable: true,
        });
        this.logger.warn({ taskId, code: 'service_shutdown' }, 'Agent task terminated');
        return;
      }
      const taskError = controller.signal.aborted
        ? new AgentTaskError('budget_exceeded', 'Agent task duration budget was exceeded')
        : toAgentTaskError(error);
      const status =
        taskError.code === 'dependency_unavailable'
          ? 'blocked'
          : taskError.code === 'outcome_unknown'
            ? 'interrupted'
            : 'failed';
      this.repository.fail(
        taskId,
        status,
        taskError.toProblem(),
        taskError.executionTrace?.toolCalls,
        taskError.executionTrace?.usage
      );
      this.logger.warn({ taskId, code: taskError.code }, 'Agent task terminated');
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(taskId);
      const status = this.repository.get(taskId)?.status;
      if (status !== 'paused') {
        this.activeRequests.delete(taskId);
        this.toolCallsStarted.delete(taskId);
      }
      this.controlActions.delete(taskId);
    }
  }

  private async applyCommand(
    taskId: string,
    request: AgentTaskCommandRequest,
    requestHash: string
  ): Promise<AgentTaskCommandResult> {
    const command = this.repository.createCommand({
      id: request.commandId,
      taskId,
      type: request.type,
      expectedStateVersion: request.expectedStateVersion,
      requestHash,
      createdBy: request.createdBy ?? 'api',
      ...(request.reason ? { reason: request.reason } : {}),
      createdAt: new Date().toISOString(),
    });
    if (command.status !== 'accepted') {
      return { command, task: this.get(taskId) };
    }

    try {
      switch (request.type) {
        case 'pause':
          await this.pauseTask(taskId, command);
          break;
        case 'resume':
          this.resumeTask(taskId);
          break;
        case 'interrupt':
          await this.terminateTask(taskId, 'interrupted', command);
          break;
        case 'cancel':
          await this.terminateTask(taskId, 'cancelled', command);
          break;
      }
      const task = this.get(taskId);
      return {
        command: this.repository.completeCommand(command.id, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          result: { status: task.status, stateVersion: task.stateVersion },
        }),
        task: this.get(taskId),
      };
    } catch (error) {
      const problem = toAgentTaskError(error).toProblem();
      return {
        command: this.repository.completeCommand(command.id, {
          status: 'rejected',
          completedAt: new Date().toISOString(),
          error: problem,
        }),
        task: this.get(taskId),
      };
    }
  }

  private async pauseTask(taskId: string, command: AgentTaskCommandRecord): Promise<void> {
    const task = this.get(taskId);
    if (task.status !== 'running') {
      throw new AgentTaskError('conflict', `Agent task ${taskId} is not running`);
    }
    if ((this.toolCallsStarted.get(taskId) ?? 0) > 0) {
      throw new AgentTaskError(
        'conflict',
        'Agent task cannot be paused after a tool call has started; interrupt it instead'
      );
    }
    this.repository.pause(taskId, {
      id: `pause:${command.id}`,
      taskId,
      payload: { kind: 'safe_pause', toolCallsStarted: 0 },
      createdAt: new Date().toISOString(),
    });
    this.controlActions.set(taskId, 'pause');
    this.controllers.get(taskId)?.abort();
    await this.taskRuns.get(taskId);
  }

  private resumeTask(taskId: string): void {
    if (this.get(taskId).status !== 'paused') {
      throw new AgentTaskError('conflict', `Agent task ${taskId} is not paused`);
    }
    if (!this.activeRequests.has(taskId)) {
      throw new AgentTaskError(
        'conflict',
        'Paused task runtime is unavailable; create a new task from its checkpoint'
      );
    }
    if (this.taskRuns.has(taskId)) {
      throw new AgentTaskError('conflict', 'Agent task pause has not reached a safe boundary');
    }
    this.repository.resume(taskId);
    this.toolCallsStarted.set(taskId, 0);
    this.schedule(taskId);
  }

  private async terminateTask(
    taskId: string,
    status: Extract<AgentTaskStatus, 'interrupted' | 'cancelled'>,
    command: AgentTaskCommandRecord
  ): Promise<void> {
    const task = this.get(taskId);
    if (!['created', 'running', 'paused'].includes(task.status)) {
      throw new AgentTaskError('conflict', `Agent task ${taskId} is already terminal`);
    }
    this.controlActions.set(taskId, command.type);
    this.repository.fail(taskId, status, {
      code: command.type === 'cancel' ? 'cancelled_by_command' : 'interrupted_by_command',
      message:
        command.type === 'cancel'
          ? 'Agent task was cancelled by command'
          : 'Agent task was interrupted by command',
      retryable: command.type === 'interrupt',
    });
    this.controllers.get(taskId)?.abort();
    await this.taskRuns.get(taskId);
    this.activeRequests.delete(taskId);
    this.toolCallsStarted.delete(taskId);
  }
}

function validateCommandRequest(raw: unknown): AgentTaskCommandRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AgentTaskError('validation_failed', 'Agent command body must be an object');
  }
  const value = raw as Record<string, unknown>;
  const unknown = Object.keys(value).filter(
    (key) => !['commandId', 'type', 'expectedStateVersion', 'reason', 'createdBy'].includes(key)
  );
  if (unknown.length > 0) {
    throw new AgentTaskError('validation_failed', 'Agent command contains unknown fields', false, {
      unknownFields: unknown,
    });
  }
  if (
    typeof value.commandId !== 'string' ||
    value.commandId.length < 1 ||
    value.commandId.length > 128
  ) {
    throw new AgentTaskError('validation_failed', 'commandId is invalid');
  }
  if (!['pause', 'resume', 'interrupt', 'cancel'].includes(String(value.type))) {
    throw new AgentTaskError('validation_failed', 'Agent command type is invalid');
  }
  if (
    !Number.isSafeInteger(value.expectedStateVersion) ||
    (value.expectedStateVersion as number) < 1
  ) {
    throw new AgentTaskError('validation_failed', 'expectedStateVersion must be positive');
  }
  for (const key of ['reason', 'createdBy'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key].length > 1000)) {
      throw new AgentTaskError('validation_failed', `${key} is invalid`);
    }
  }
  return value as unknown as AgentTaskCommandRequest;
}

function hashCommandRequest(taskId: string, request: AgentTaskCommandRequest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        taskId,
        commandId: request.commandId,
        type: request.type,
        expectedStateVersion: request.expectedStateVersion,
        reason: request.reason ?? null,
        createdBy: request.createdBy ?? 'api',
      })
    )
    .digest('hex');
}
