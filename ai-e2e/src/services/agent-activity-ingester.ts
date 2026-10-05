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
  phase: 'catch-up' | 'stream' | 'retry';
  controller: AbortController;
  run: Promise<void>;
}

interface AgentActivityIngesterOptions {
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const ACTIVITY_BATCH_SIZE = 500;
const MAX_RETRY_DELAY_MS = 30_000;
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);

export class AgentActivityIngester implements AgentActivityIngesterPort {
  private readonly ingestions = new Map<string, Ingestion>();
  private readonly wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;

  constructor(
    private readonly client: AgentTaskActivitySource,
    private readonly repository: Pick<AgentActivityRepository, 'cursor' | 'append'>,
    options: AgentActivityIngesterOptions = {}
  ) {
    this.wait = options.wait ?? waitForRetry;
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
      controller: new AbortController(),
      run: Promise.resolve(),
    };
    this.ingestions.set(key, ingestion);
    ingestion.run = this.consume(ingestion).finally(() => {
      if (this.ingestions.get(key) === ingestion) this.ingestions.delete(key);
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
    const { signal } = ingestion.controller;

    while (!signal.aborted) {
      ingestion.phase = 'catch-up';
      try {
        if (await this.catchUp(ingestion, signal)) return;
        if (ingestion.stopAfterCatchUp) return;

        let terminal = false;
        const handlers: AgentTaskActivityStreamHandlers = {
          onSnapshot: async (snapshot) => {
            ingestion.phase = 'catch-up';
            const caughtUpToSnapshot = await this.catchUp(ingestion, signal);
            terminal =
              caughtUpToSnapshot || isTerminalSnapshot(snapshot) || ingestion.stopAfterCatchUp;
            if (terminal) ingestion.controller.abort();
            else ingestion.phase = 'stream';
          },
          onEvent: (event) => {
            this.repository.append(ingestion.context, ingestion.taskId, event, ingestion.links);
            if (isTerminalEvent(event)) {
              terminal = true;
              ingestion.controller.abort();
            }
          },
        };

        await this.client.streamTaskActivity(ingestion.taskId, signal, handlers);
        if (terminal) return;
      } catch {
        if (signal.aborted) return;
        if (ingestion.stopAfterCatchUp) {
          await this.wait(retryDelayMs, signal);
          retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
          continue;
        }
      }

      if (signal.aborted) return;
      if (ingestion.stopAfterCatchUp) return;
      ingestion.phase = 'retry';
      await this.wait(retryDelayMs, signal);
      retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    }
  }

  private async catchUp(ingestion: Ingestion, signal?: AbortSignal): Promise<boolean> {
    let afterSeq = this.repository.cursor(ingestion.context, ingestion.taskId);

    while (!signal?.aborted) {
      const events = await this.client.listTaskActivity(
        ingestion.taskId,
        afterSeq,
        ACTIVITY_BATCH_SIZE,
        signal
      );
      if (signal?.aborted) return false;

      const previousSeq = afterSeq;
      for (const event of events) {
        this.repository.append(ingestion.context, ingestion.taskId, event, ingestion.links);
        afterSeq = Math.max(afterSeq, event.seq);
        if (isTerminalEvent(event)) return true;
      }

      if (events.length < ACTIVITY_BATCH_SIZE || afterSeq === previousSeq) return false;
    }

    return false;
  }
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
