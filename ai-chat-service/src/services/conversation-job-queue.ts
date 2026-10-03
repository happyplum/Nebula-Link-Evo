import { randomUUID } from 'node:crypto';
import { Mutex } from 'async-mutex';
import { ServiceUnavailableError } from '../errors/http-errors.js';
import type { ChatSessionController } from './chat-session-controller.js';
import { chatFailureState } from './chat-failure-state.js';
import type { SessionEventHub } from '../conversation/session-event-hub.js';
import { createWorkerLogger } from './logger.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';

const logger = createWorkerLogger('ConversationJobQueue');

const MAX_RETRIES = 3;

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
  jobId: string;
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
  private eventHub?: SessionEventHub;
  private readonly runs = new Set<Promise<void>>();
  private accepting = true;

  constructor(
    private readonly sessionController: ChatSessionController,
    eventHub: SessionEventHub | undefined,
    private readonly runScheduler: HarnessRunScheduler,
    private readonly admitNewRun: () => void
  ) {
    this.eventHub = eventHub;
  }

  async enqueue(payload: JobPayload): Promise<string> {
    if (!this.accepting) {
      throw new ServiceUnavailableError('Job queue is shutting down');
    }
    if (this.jobs.size >= this.maxQueueSize) {
      throw new ServiceUnavailableError('Job queue is full');
    }
    this.admitNewRun();

    const id = randomUUID();
    this.runScheduler.enqueue({
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
        await this.sessionController.beginRun(payload.sessionId, id);
        let attempts = 0;
        while (attempts < MAX_RETRIES) {
          if (
            this.jobs.get(job.id)?.status === 'cancelled' ||
            !this.sessionController.isRunning(payload.sessionId, id)
          )
            return;
          try {
            await originalExecute(context);
            this.sessionController.complete(payload.sessionId, id);
            return;
          } catch (error) {
            if (
              this.jobs.get(job.id)?.status === 'cancelled' ||
              !this.sessionController.isRunning(payload.sessionId, id)
            )
              return;
            attempts++;
            const failure = chatFailureState(error, attempts);
            if (!failure.retryable) {
              this.sessionController.block(payload.sessionId, id, failure.agentState);
              return;
            }
            if (attempts < MAX_RETRIES) {
              if (!this.sessionController.recordRetry(payload.sessionId, id, failure.agentState))
                return;
              continue;
            }
            this.sessionController.block(payload.sessionId, id, failure.agentState);
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
        if (this.jobs.get(job.id)?.status === 'cancelled') {
          return;
        }

        await this.runScheduler.wait(job.id);
        if (this.jobs.get(job.id)?.status === 'cancelled') return;

        job.status = 'running';
        job.startedAt = new Date();
        this.sessionLastActive.set(job.sessionId, Date.now());

        // Emit job.started event
        if (this.eventHub) {
          this.eventHub.emitJobStarted(job.sessionId, job.id);
        }

        await job.execute({ maxToolLoops: this.maxToolLoops, jobId: job.id });

        if (this.jobs.get(job.id)?.status === 'cancelled') return;
        job.status = 'completed';
        job.completedAt = new Date();

        // Emit job.completed event
        if (this.eventHub) {
          this.eventHub.emitJobCompleted(job.sessionId, job.id);
        }
      })
      .catch((error) => {
        if (this.jobs.get(job.id)?.status === 'cancelled') return;
        job.status = 'failed';
        job.completedAt = new Date();
        job.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => this.runScheduler.complete(job.id));

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

    if (
      this.jobs.get(job.id)?.status === 'cancelled' ||
      job.status === 'completed' ||
      job.status === 'failed'
    ) {
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
      this.runScheduler.cancel(jobId);

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
      this.runScheduler.cancel(jobId);

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
        (job.status === 'completed' ||
          job.status === 'failed' ||
          this.jobs.get(job.id)?.status === 'cancelled') &&
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
