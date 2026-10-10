import type {
  AgentStreamEventV1,
  AgentStreamSnapshotV1,
} from '@nebula-link-evo/shared/types/agent-stream';
import type {
  AgentTaskActivitySource,
  AgentTaskActivityStreamHandlers,
} from '../infrastructure/agent-task-client.js';
import type {
  ActivityContext,
  AgentActivityRepository,
} from '../database/repositories/agent-activity-repository.js';
import { IntegrationClientError } from '../infrastructure/integration-client-error.js';

type CatchUpTrigger = 'initial-connect' | 'reconnect' | 'post-snapshot-bridge';
type IngestionPhase = 'catch-up' | 'stream' | 'retry';
type IngestionStopReason =
  | 'explicit_task_stop'
  | 'explicit_context_stop'
  | 'explicit_global_stop'
  | 'terminal_event'
  | 'terminal_snapshot'
  | 'terminal_error'
  | 'ingestion_finished';
type ErrorClassification = 'retryable' | 'terminal' | 'unknown' | 'clean_eof';

interface AgentActivityIngesterLogger {
  info(fields: Record<string, string | number>, message: string): void;
  warn(fields: Record<string, string | number>, message: string): void;
}

export interface AgentActivityIngesterPort {
  start(
    taskId: string,
    context: ActivityContext,
    links?: Parameters<AgentActivityRepository['append']>[3]
  ): void;
  stop(taskId?: string, context?: ActivityContext): void;
  onceIdle(): Promise<void>;
}

interface Ingestion {
  taskId: string;
  context: ActivityContext;
  links: Parameters<AgentActivityRepository['append']>[3];
  stopAfterCatchUp: boolean;
  phase: IngestionPhase;
  stopReason?: IngestionStopReason;
  retryCount: number;
  controller: AbortController;
  run: Promise<void>;
}

interface AgentActivityIngesterOptions {
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  logger?: AgentActivityIngesterLogger;
}

const ACTIVITY_BATCH_SIZE = 500;
const MAX_RETRY_DELAY_MS = 30_000;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

export class AgentActivityIngester implements AgentActivityIngesterPort {
  private readonly ingestions = new Map<string, Ingestion>();
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly logger?: AgentActivityIngesterLogger;

  constructor(
    private readonly client: AgentTaskActivitySource,
    private readonly repository: Pick<AgentActivityRepository, 'cursor' | 'append'>,
    options: AgentActivityIngesterOptions = {}
  ) {
    this.wait = options.wait ?? waitForRetry;
    this.logger = options.logger;
  }

  start(
    taskId: string,
    context: ActivityContext,
    links: Parameters<AgentActivityRepository['append']>[3] = {}
  ): void {
    const key = ingestionKey(taskId, context);
    if (this.ingestions.has(key)) return;

    const ingestion: Ingestion = {
      taskId,
      context,
      links,
      stopAfterCatchUp: false,
      phase: 'catch-up',
      retryCount: 0,
      controller: new AbortController(),
      run: Promise.resolve(),
    };
    this.ingestions.set(key, ingestion);
    logActivity(
      this.logger,
      'info',
      'Agent activity subscription started',
      ingestion
    );
    ingestion.run = this.consume(ingestion).finally(() => {
      if (this.ingestions.get(key) === ingestion) this.ingestions.delete(key);
      logActivity(
        this.logger,
        'info',
        'Agent activity subscription stopped',
        ingestion,
        { reason: ingestion.stopReason ?? 'ingestion_finished' }
      );
    });
  }

  stop(taskId?: string, context?: ActivityContext): void {
    for (const ingestion of this.ingestions.values()) {
      if (taskId !== undefined && ingestion.taskId !== taskId) continue;
      if (
        context !== undefined &&
        (ingestion.context.type !== context.type || ingestion.context.id !== context.id)
      ) {
        continue;
      }
      this.setStopReason(
        ingestion,
        taskId !== undefined
          ? 'explicit_task_stop'
          : context !== undefined
            ? 'explicit_context_stop'
            : 'explicit_global_stop'
      );
      if (taskId !== undefined && ingestion.phase === 'catch-up') {
        ingestion.stopAfterCatchUp = true;
      } else {
        ingestion.controller.abort();
      }
    }
  }

  async onceIdle(): Promise<void> {
    while (this.ingestions.size > 0) {
      await Promise.all([...this.ingestions.values()].map((ingestion) => ingestion.run));
    }
  }

  private async consume(ingestion: Ingestion): Promise<void> {
    let retryDelayMs = 1_000;
    let catchUpTrigger: CatchUpTrigger = 'initial-connect';
    const { signal } = ingestion.controller;

    while (!signal.aborted) {
      ingestion.phase = 'catch-up';
      let continueAfterStopCatchUp = false;
      try {
        if (await this.catchUp(ingestion, signal, catchUpTrigger)) return;
        if (ingestion.stopAfterCatchUp) return;

        let terminal = false;
        let snapshotReceived = false;
        const handlers: AgentTaskActivityStreamHandlers = {
          onSnapshot: async (snapshot) => {
            if (!snapshotReceived) {
              snapshotReceived = true;
              logActivity(
                this.logger,
                'info',
                'Agent activity subscription connected',
                ingestion,
                { stage: 'snapshot-received', sourceSeq: snapshot.seq }
              );
            }
            ingestion.phase = 'catch-up';
            const caughtUpToSnapshot = await this.catchUp(
              ingestion,
              signal,
              'post-snapshot-bridge'
            );
            terminal =
              caughtUpToSnapshot || isTerminalSnapshot(snapshot) || ingestion.stopAfterCatchUp;
            if (isTerminalSnapshot(snapshot)) this.setStopReason(ingestion, 'terminal_snapshot');
            if (terminal) ingestion.controller.abort();
            else ingestion.phase = 'stream';
          },
          onEvent: (event) => {
            this.repository.append(ingestion.context, ingestion.taskId, event, ingestion.links);
            if (isTerminalEvent(event)) {
              terminal = true;
              this.setStopReason(ingestion, 'terminal_event');
              ingestion.controller.abort();
            }
          },
        };

        ingestion.phase = 'stream';
        catchUpTrigger = 'reconnect';
        await this.client.streamTaskActivity(ingestion.taskId, signal, handlers);
        if (terminal) return;
        if (signal.aborted) return;
        this.logRetry(
          ingestion,
          'stream',
          'clean_eof',
          retryDelayMs,
          undefined,
          'stream ended without a terminal event'
        );
      } catch (error) {
        if (signal.aborted) return;
        const failureStage = ingestion.phase;
        const failure = classifyFailure(error);
        if (failure.classification === 'terminal') {
          this.setStopReason(ingestion, 'terminal_error');
          logActivity(
            this.logger,
            'warn',
            'Agent activity subscription stopped after terminal error',
            ingestion,
            {
              stage: failureStage,
              classification: failure.classification,
              errorName: failure.errorName,
              detail: failure.detail,
            }
          );
          return;
        }
        this.logRetry(ingestion, failureStage, failure.classification, retryDelayMs, failure);
        continueAfterStopCatchUp = ingestion.stopAfterCatchUp;
      }

      if (signal.aborted) return;
      if (ingestion.stopAfterCatchUp && !continueAfterStopCatchUp) return;
      ingestion.phase = 'retry';
      await this.wait(retryDelayMs, signal);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
      if (continueAfterStopCatchUp) continue;
    }
  }

  private async catchUp(
    ingestion: Ingestion,
    signal: AbortSignal,
    trigger: CatchUpTrigger
  ): Promise<boolean> {
    const startCursor = this.repository.cursor(ingestion.context, ingestion.taskId);
    let afterSeq = startCursor;
    let pagesRequested = 0;
    let entriesRead = 0;
    const startedAt = Date.now();

    try {
      while (!signal.aborted) {
        pagesRequested += 1;
        const events = await this.client.listTaskActivity(
          ingestion.taskId,
          afterSeq,
          ACTIVITY_BATCH_SIZE,
          signal
        );
        entriesRead += events.length;
        if (signal.aborted) return false;

        const previousSeq = afterSeq;
        for (const event of events) {
          this.repository.append(ingestion.context, ingestion.taskId, event, ingestion.links);
          afterSeq = Math.max(afterSeq, event.seq);
          if (isTerminalEvent(event)) {
            this.setStopReason(ingestion, 'terminal_event');
            return true;
          }
        }

        if (events.length < ACTIVITY_BATCH_SIZE || afterSeq === previousSeq) return false;
      }

      return false;
    } finally {
      logActivity(
        this.logger,
        'info',
        'Agent activity catch-up completed',
        ingestion,
        {
          stage: 'catch-up',
          trigger,
          pagesRequested,
          entriesRead,
          startCursor,
          endCursor: afterSeq,
          durationMs: Math.max(0, Date.now() - startedAt),
        }
      );
    }
  }

  private logRetry(
    ingestion: Ingestion,
    stage: IngestionPhase,
    classification: ErrorClassification,
    nextDelayMs: number,
    failure?: { errorName: string; detail: string },
    cleanEofDetail?: string
  ): void {
    ingestion.retryCount += 1;
    logActivity(
      this.logger,
      'warn',
      'Agent activity subscription retry scheduled',
      ingestion,
      {
        stage,
        classification,
        retryCount: ingestion.retryCount,
        nextDelayMs,
        ...(failure ? { errorName: failure.errorName, detail: failure.detail } : {}),
        ...(cleanEofDetail ? { detail: cleanEofDetail } : {}),
      }
    );
  }

  private setStopReason(ingestion: Ingestion, reason: IngestionStopReason): void {
    ingestion.stopReason ??= reason;
  }
}

type ActivityLogFields = {
  taskId: string;
  contextType: ActivityContext['type'];
  contextId: string;
  stage?: string;
  reason?: IngestionStopReason;
  trigger?: CatchUpTrigger;
  pagesRequested?: number;
  entriesRead?: number;
  startCursor?: number;
  endCursor?: number;
  durationMs?: number;
  sourceSeq?: number;
  retryCount?: number;
  nextDelayMs?: number;
  classification?: ErrorClassification;
  errorName?: string;
  detail?: string;
};

function logActivity(
  logger: AgentActivityIngesterLogger | undefined,
  level: 'info' | 'warn',
  message: string,
  ingestion: Pick<Ingestion, 'taskId' | 'context'>,
  details: Partial<Omit<ActivityLogFields, 'taskId' | 'contextType' | 'contextId'>> = {}
): void {
  if (!logger) return;
  const fields: Record<string, string | number> = {
    taskId: ingestion.taskId,
    contextType: ingestion.context.type,
    contextId: ingestion.context.id,
  };
  if (details.stage !== undefined) fields.stage = details.stage;
  if (details.reason !== undefined) fields.reason = details.reason;
  if (details.trigger !== undefined) fields.trigger = details.trigger;
  if (details.pagesRequested !== undefined) fields.pagesRequested = details.pagesRequested;
  if (details.entriesRead !== undefined) fields.entriesRead = details.entriesRead;
  if (details.startCursor !== undefined) fields.startCursor = details.startCursor;
  if (details.endCursor !== undefined) fields.endCursor = details.endCursor;
  if (details.durationMs !== undefined) fields.durationMs = details.durationMs;
  if (details.sourceSeq !== undefined) fields.sourceSeq = details.sourceSeq;
  if (details.retryCount !== undefined) fields.retryCount = details.retryCount;
  if (details.nextDelayMs !== undefined) fields.nextDelayMs = details.nextDelayMs;
  if (details.classification !== undefined) fields.classification = details.classification;
  if (details.errorName !== undefined) fields.errorName = details.errorName;
  if (details.detail !== undefined) fields.detail = details.detail;
  logger[level](fields, message);
}

function classifyFailure(error: unknown): {
  classification: Exclude<ErrorClassification, 'clean_eof'>;
  errorName: string;
  detail: string;
} {
  if (error instanceof IntegrationClientError) {
    return {
      classification: error.retryable ? 'retryable' : 'terminal',
      errorName: 'IntegrationClientError',
      detail:
        error.statusCode === undefined
          ? `service=${error.service}`
          : `service=${error.service} status=${error.statusCode}`,
    };
  }
  if (error instanceof Error) {
    return {
      classification: 'unknown',
      errorName: error.constructor.name,
      detail: 'unclassified failure',
    };
  }
  return {
    classification: 'unknown',
    errorName: 'UnknownError',
    detail: 'unclassified failure',
  };
}

function isTerminalSnapshot(snapshot: AgentStreamSnapshotV1): boolean {
  return TERMINAL_STATES.has(snapshot.state);
}

function isTerminalEvent(event: AgentStreamEventV1): boolean {
  return (
    event.type === 'turn.completed' ||
    (event.type === 'stream.state' && TERMINAL_STATES.has(event.state))
  );
}

function ingestionKey(taskId: string, context: ActivityContext): string {
  return JSON.stringify([context.type, context.id, taskId]);
}

function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    timer.unref();
    signal.addEventListener('abort', finish, { once: true });
  });
}
