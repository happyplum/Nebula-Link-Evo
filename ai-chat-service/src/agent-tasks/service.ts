import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { AgentTaskError, toAgentTaskError } from './errors.js';
import type { AgentTaskExecutor, AgentTaskView } from './types.js';
import { validateCreateAgentTaskRequest } from './validation.js';
import type { AgentTaskRepository } from './repository.js';

export interface CreateAgentTaskOptions {
  idempotencyKey?: string;
}

export interface CreateAgentTaskResult {
  task: AgentTaskView;
  created: boolean;
}

export class AgentTaskService {
  private readonly activeRequests = new Map<
    string,
    ReturnType<typeof validateCreateAgentTaskRequest>['request']
  >();
  private readonly controllers = new Map<string, AbortController>();
  private readonly runs = new Set<Promise<void>>();
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
      this.schedule(taskId);
    }
    return stored;
  }

  get(taskId: string): AgentTaskView {
    const task = this.repository.get(taskId);
    if (!task) throw new AgentTaskError('not_found', `Agent task ${taskId} was not found`);
    return task;
  }

  async close(): Promise<void> {
    this.closing = true;
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.runs);
    this.activeRequests.clear();
    this.repository.close();
  }

  private schedule(taskId: string): void {
    const run = new Promise<void>((resolve) => {
      setImmediate(() => void this.run(taskId).finally(resolve));
    });
    this.runs.add(run);
    void run.finally(() => this.runs.delete(run));
  }

  private async run(taskId: string): Promise<void> {
    const request = this.activeRequests.get(taskId);
    if (!request) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.budgets.maxDurationMs);
    timeout.unref();
    this.controllers.set(taskId, controller);
    this.repository.markRunning(taskId);
    this.logger.info({ taskId, clientTaskId: request.clientTaskId }, 'Agent task started');
    try {
      const result = await this.executor.execute({
        taskId,
        request,
        deadlineAt: Date.now() + request.budgets.maxDurationMs,
        signal: controller.signal,
      });
      this.repository.complete(taskId, result);
      this.logger.info(
        { taskId, terminationReason: result.terminationReason },
        'Agent task completed'
      );
    } catch (error) {
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
      this.activeRequests.delete(taskId);
    }
  }
}
