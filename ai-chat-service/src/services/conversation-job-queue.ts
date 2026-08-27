import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { ServiceUnavailableError } from '../errors/http-errors.js';
import { DatabaseManager } from '../conversation/db.js';
import type { AgentState } from '../conversation/types.js';
import { StreamPersistWorker } from './stream-persist-worker.js';
import type { SessionEventHub } from '../conversation/session-event-hub.js';
import { ProviderError, PROVIDER_ERRORS } from './provider/errors.js';
import { createWorkerLogger } from './logger.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';

const logger = createWorkerLogger('ConversationJobQueue');

type BlockReason = NonNullable<AgentState['blockReason']>;
type WaitingFor = NonNullable<AgentState['waitingFor']>;

const MAX_RETRIES = 3;

const ALLOWED_BLOCK_REASONS: ReadonlySet<string> = new Set([
  'waiting_for_user_input',
  'api_error',
  'rate_limit',
  'validation_failed',
  'timeout',
]);

const ALLOWED_WAITING_FOR: ReadonlySet<string> = new Set([
  'user_message',
  'api_retry',
  'external_confirmation',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractBlockedAgentState(
  error: unknown
): Pick<AgentState, 'blockReason' | 'waitingFor'> | null {
  if (!isRecord(error)) {
    return null;
  }

  const blockReason = error.blockReason;
  if (typeof blockReason !== 'string') {
    return null;
  }

  // Treat job_error as an internal failure reason, not a "blocked" signal.
  if (blockReason === 'job_error') {
    return null;
  }

  if (!ALLOWED_BLOCK_REASONS.has(blockReason)) {
    return null;
  }

  const waitingFor = error.waitingFor;
  const result: Pick<AgentState, 'blockReason' | 'waitingFor'> = {
    blockReason: blockReason as BlockReason,
  };

  if (typeof waitingFor === 'string' && ALLOWED_WAITING_FOR.has(waitingFor)) {
    result.waitingFor = waitingFor as WaitingFor;
  }

  return result;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export interface Job {
  id: string;
  sessionId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export interface JobContext {
  maxToolLoops: number;
}

export interface JobPayload {
  sessionId: string;
  execute: (context: JobContext) => Promise<void>;
  messageId?: string;
  contentPreview?: string;
  idempotencyKey?: string;
}

interface PendingJobInfo {
  jobId: string;
  sessionId: string;
  messageId: string;
  contentPreview: string;
  createdAt: string;
  status: 'queued' | 'running';
}

export class ConversationJobQueue {
  private jobs = new Map<string, Job & JobPayload>();
  private sessionLocks = new Map<string, Mutex>();
  private sessionLastActive = new Map<string, number>();
  private maxIdleTime = 10 * 60 * 1000; // 10 minutes
  private maxToolLoops = 10;
  private maxQueueSize = 1000;
  private persistWorker: StreamPersistWorker;
  private eventHub?: SessionEventHub;
  private readonly db: DatabaseManager;
  private readonly runs = new Set<Promise<void>>();
  private accepting = true;

  constructor(
    persistWorker: StreamPersistWorker,
    eventHub?: SessionEventHub,
    db: DatabaseManager = DatabaseManager.getInstance(),
    private readonly runScheduler?: HarnessRunScheduler,
    private readonly admitNewRun?: () => void
  ) {
    this.persistWorker = persistWorker;
    this.eventHub = eventHub;
    this.db = db;
  }

  private getSessionStateDAO() {
    try {
      return this.db.getSessionStateDAO();
    } catch {
      return null;
    }
  }

  private async syncSessionState(
    sessionId: string,
    params: {
      status: 'running' | 'completed' | 'blocked';
      jobId?: string;
      agentState?: AgentState;
    }
  ): Promise<void> {
    const dao = this.getSessionStateDAO();
    if (!dao) {
      return;
    }

    // Ensure the row exists; SessionStateDAO.get() auto-creates.
    await dao.get(sessionId);

    const now = new Date().toISOString();
    await dao.update(sessionId, {
      status: params.status,
      jobId: params.jobId,
      agentState: params.agentState,
      lastActiveAt: now,
    });
  }

  private async syncCompletedUnlessPaused(sessionId: string, jobId: string): Promise<void> {
    const current = await this.getSessionStateDAO()?.get(sessionId);
    if (current?.status === 'paused') return;
    await this.syncSessionState(sessionId, { status: 'completed', jobId });
  }

  async enqueue(payload: JobPayload): Promise<string> {
    if (!this.accepting) {
      throw new ServiceUnavailableError('Job queue is shutting down');
    }
    if (this.jobs.size >= this.maxQueueSize) {
      throw new ServiceUnavailableError('Job queue is full');
    }
    this.admitNewRun?.();

    const id = randomUUID();
    this.runScheduler?.enqueue({
      runId: id,
      ownerType: 'chat',
      ownerId: payload.sessionId,
      messageId: payload.messageId ?? id,
      ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
    });
    const originalExecute = payload.execute;

    const job: Job & JobPayload = {
      ...payload,
      id,
      status: 'queued',
      createdAt: new Date(),
      execute: async (context) => {
        await this.syncSessionState(payload.sessionId, {
          status: 'running',
          jobId: id,
        });

        let attempts = 0;
        while (attempts < MAX_RETRIES) {
          try {
            await originalExecute(context);
            await this.syncCompletedUnlessPaused(payload.sessionId, id);
            return;
          } catch (error) {
            // Rate-limit errors — block with rate_limit reason (no retry)
            if (error instanceof ProviderError && error.code === PROVIDER_ERRORS.RATE_LIMITED) {
              const retryAfterMs = (error.details as { retryAfterMs?: number } | undefined)
                ?.retryAfterMs;
              await this.syncSessionState(payload.sessionId, {
                status: 'blocked',
                jobId: id,
                agentState: {
                  schema_version: 1,
                  blockReason: 'rate_limit',
                  waitingFor: 'api_retry',
                  lastError: toErrorMessage(error),
                  ...(retryAfterMs != null ? { retryAfterMs } : {}),
                },
              });
              return;
            }

            // Other provider errors are non-retryable — block immediately
            if (error instanceof ProviderError) {
              await this.syncSessionState(payload.sessionId, {
                status: 'blocked',
                jobId: id,
                agentState: {
                  schema_version: 1,
                  blockReason: 'api_error',
                  lastError: `Provider '${error.provider}' error: ${toErrorMessage(error)}`,
                },
              });
              return;
            }

            const blocked = extractBlockedAgentState(error);
            if (blocked) {
              await this.syncSessionState(payload.sessionId, {
                status: 'blocked',
                jobId: id,
                agentState: {
                  schema_version: 1,
                  ...blocked,
                },
              });
              return;
            }

            attempts++;

            if (attempts < MAX_RETRIES) {
              await this.syncSessionState(payload.sessionId, {
                status: 'running',
                jobId: id,
                agentState: {
                  schema_version: 1,
                  blockReason: 'job_error',
                  waitingFor: 'api_retry',
                  retryCount: attempts,
                  lastError: toErrorMessage(error),
                },
              });
              continue;
            }

            await this.syncSessionState(payload.sessionId, {
              status: 'blocked',
              jobId: id,
              agentState: {
                schema_version: 1,
                blockReason: 'job_error',
                waitingFor: 'api_retry',
                retryCount: attempts,
                lastError: toErrorMessage(error),
              },
            });

            throw error;
          }
        }
      },
    };

    this.jobs.set(id, job);
    this.sessionLastActive.set(job.sessionId, Date.now());

    // Emit job.queued event
    if (this.eventHub) {
      this.eventHub.emitJobQueued(payload.sessionId, {
        jobId: id,
        messageId: payload.messageId ?? '',
        contentPreview: payload.contentPreview ?? '',
        createdAt: job.createdAt.getTime(),
      });
    }

    // Start execution in background on next tick
    const run = Promise.resolve().then(() => this.executeJob(job));
    this.runs.add(run);
    void run
      .catch((err) => logger.error({ err }, 'Job execution failed'))
      .finally(() => this.runs.delete(run));

    return id;
  }

  private async executeJob(job: Job & JobPayload): Promise<void> {
    let lock = this.sessionLocks.get(job.sessionId);
    if (!lock) {
      lock = new Mutex();
      this.sessionLocks.set(job.sessionId, lock);
    }

    await lock
      .runExclusive(async () => {
        if (job.status === 'cancelled') {
          return;
        }

        await this.runScheduler?.wait(job.id);

        job.status = 'running';
        job.startedAt = new Date();
        this.sessionLastActive.set(job.sessionId, Date.now());

        // Emit job.started event
        if (this.eventHub) {
          this.eventHub.emitJobStarted(job.sessionId, job.id);
        }

        await job.execute({ maxToolLoops: this.maxToolLoops });

        job.status = 'completed';
        job.completedAt = new Date();

        // Emit job.completed event
        if (this.eventHub) {
          this.eventHub.emitJobCompleted(job.sessionId, job.id);
        }
      })
      .catch((error) => {
        job.status = 'failed';
        job.completedAt = new Date();
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => this.runScheduler?.complete(job.id));

    this.sessionLastActive.set(job.sessionId, Date.now());
  }

  getStatus(jobId: string): Job | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;

    // Return a copy without the execute function
    const jobData: Job = {
      id: job.id,
      sessionId: job.sessionId,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
    };
    return jobData;
  }

  getPendingJobs(sessionId: string): PendingJobInfo[] {
    const pendingJobs: PendingJobInfo[] = [];

    for (const job of this.jobs.values()) {
      if (job.sessionId === sessionId && (job.status === 'queued' || job.status === 'running')) {
        pendingJobs.push({
          jobId: job.id,
          sessionId: job.sessionId,
          messageId: job.messageId ?? '',
          contentPreview: job.contentPreview ?? '',
          createdAt: job.createdAt.toISOString(),
          status: job.status,
        });
      }
    }

    return pendingJobs;
  }

  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) {
      return false;
    }

    if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') {
      return false;
    }

    if (job.status === 'running') {
      // Currently cannot cancel running jobs
      // This will be handled in T9
      return false;
    }

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.completedAt = new Date();
      this.runScheduler?.cancel(jobId);

      if (this.eventHub) {
        this.eventHub.emitJobCancelled(job.sessionId, jobId);
      }

      // Clean up lock if no other jobs are queued for this session
      this.cleanupSessionLock(job.sessionId);
      return true;
    }

    return false;
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && (job.status === 'queued' || job.status === 'running')) {
      job.status = 'cancelled';
      job.completedAt = new Date();
      this.runScheduler?.cancel(jobId);

      // Emit job.cancelled event
      if (this.eventHub) {
        this.eventHub.emitJobCancelled(job.sessionId, jobId);
      }

      // Clean up lock if no other jobs are queued for this session
      this.cleanupSessionLock(job.sessionId);
    }
  }

  private cleanupSessionLock(sessionId: string): void {
    const hasActiveJobs = Array.from(this.jobs.values()).some(
      (j) => j.sessionId === sessionId && (j.status === 'queued' || j.status === 'running')
    );

    if (!hasActiveJobs) {
      this.sessionLocks.delete(sessionId);
      this.sessionLastActive.delete(sessionId);
    }
  }

  cleanup(): void {
    const now = Date.now();

    // Cleanup idle session locks
    for (const [sessionId, lastActive] of this.sessionLastActive.entries()) {
      if (now - lastActive > this.maxIdleTime) {
        this.cleanupSessionLock(sessionId);
      }
    }

    // Cleanup old completed/failed/cancelled jobs (older than maxIdleTime)
    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') &&
        job.completedAt &&
        now - job.completedAt.getTime() > this.maxIdleTime
      ) {
        this.jobs.delete(jobId);
      }
    }
  }

  async close(): Promise<void> {
    this.stopAccepting();
    for (const job of this.jobs.values()) {
      if (job.status === 'queued') this.cancelJob(job.id);
    }
    await Promise.allSettled(this.runs);
  }

  stopAccepting(): void {
    this.accepting = false;
  }
}
