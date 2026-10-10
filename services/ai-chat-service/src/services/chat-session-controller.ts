import type { ConversationDatabase } from '../db/ConversationDatabase.js';
import type {
  AgentState,
  SessionStatus,
  TracedOperation,
  ControlCommandType,
} from '../db/types.js';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';

export class SessionNotFoundError extends Error {
  constructor(public sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export interface SessionStatusResponse {
  sessionId: string;
  status: SessionStatus;
  jobId?: string;
  currentJobId?: string;
  lastActivity: string;
  agentState?: AgentState;
}

interface ControlFlags {
  runId: string;
  pauseRequested?: boolean;
  pauseAfterGeneration?: boolean;
  pauseAfterExecution?: boolean;
}

/** sessions_state owns lifecycle and run identity; memory owns only live execution resources. */
export class ChatSessionController {
  private readonly abortControllers = new Map<
    string,
    { runId: string; controller: AbortController }
  >();
  private readonly controlFlags = new Map<string, ControlFlags>();
  private readonly logger: Logger;

  constructor(
    private readonly db: ConversationDatabase,
    logger?: Logger
  ) {
    this.logger = logger ?? createWorkerLogger('ChatSessionController');
  }

  async getStatus(sessionId: string): Promise<SessionStatusResponse> {
    const state = this.getState(sessionId);
    return {
      sessionId,
      status: state.status,
      jobId: state.jobId,
      currentJobId: state.jobId,
      lastActivity: state.lastActiveAt,
      agentState: state.agentState,
    };
  }

  async beginRun(sessionId: string, runId: string, resume = false): Promise<void> {
    const state = this.getState(sessionId);
    const allowedFrom: SessionStatus[] = resume
      ? ['paused', 'blocked']
      : ['idle', 'paused', 'blocked', 'interrupted', 'cancelled', 'completed'];
    if (
      !this.db
        .getSessionStateDAO()
        .transition(
          sessionId,
          { status: 'running', jobId: runId, agentState: null },
          state.jobId,
          allowedFrom
        )
    ) {
      throw new Error(`Cannot ${resume ? 'resume' : 'start'} session with status: ${state.status}`);
    }
    this.controlFlags.set(sessionId, {
      ...this.controlFlags.get(sessionId),
      runId,
      pauseRequested: false,
    });
    this.logOperation(sessionId, resume ? 'resume' : 'create');
  }

  isRunning(sessionId: string, runId: string): boolean {
    const state = this.getState(sessionId);
    return state.jobId === runId && state.status === 'running';
  }

  async createAbortController(sessionId: string, runId: string): Promise<AbortController> {
    if (!this.isRunning(sessionId, runId)) throw new Error('Chat run is no longer running');
    const controller = new AbortController();
    this.abortControllers.set(sessionId, { runId, controller });
    return controller;
  }

  complete(sessionId: string, runId: string): boolean {
    return this.transition(sessionId, runId, 'completed', ['running'], null);
  }

  block(sessionId: string, runId: string, agentState: AgentState): boolean {
    return this.transition(sessionId, runId, 'blocked', ['running'], agentState);
  }

  recordRetry(sessionId: string, runId: string, agentState: AgentState): boolean {
    return this.transition(sessionId, runId, 'running', ['running'], agentState);
  }

  async pause(sessionId: string): Promise<void> {
    const state = this.getState(sessionId);
    if (state.status !== 'running' || !state.jobId) {
      throw new Error(`Cannot pause session with status: ${state.status}`);
    }
    this.controlFlags.set(sessionId, {
      ...this.controlFlags.get(sessionId),
      runId: state.jobId,
      pauseRequested: true,
    });
    this.logOperation(sessionId, 'pause');
  }

  markAsPaused(sessionId: string, runId: string): boolean {
    const changed = this.transition(sessionId, runId, 'paused', ['running']);
    const flags = this.controlFlags.get(sessionId);
    if (changed && flags?.runId === runId) flags.pauseRequested = false;
    if (changed) this.logOperation(sessionId, 'mark_as_paused');
    return changed;
  }

  setPauseFlags(
    sessionId: string,
    flags: { pauseAfterGeneration?: boolean; pauseAfterExecution?: boolean }
  ): void {
    const current = this.controlFlags.get(sessionId);
    if (!current) throw new Error('Chat run has not started');
    this.controlFlags.set(sessionId, { ...current, ...flags });
    this.logOperation(sessionId, 'set_pause_flags');
  }

  shouldPause(
    sessionId: string,
    runId: string,
    point: 'afterGeneration' | 'afterExecution'
  ): boolean {
    const flags = this.controlFlags.get(sessionId);
    return (
      flags?.runId === runId &&
      Boolean(
        flags.pauseRequested ||
        (point === 'afterGeneration' ? flags.pauseAfterGeneration : flags.pauseAfterExecution)
      )
    );
  }

  async interrupt(sessionId: string): Promise<void> {
    const state = this.getState(sessionId);
    if (!state.jobId || !this.transition(sessionId, state.jobId, 'interrupted', ['running'])) {
      throw new Error(`Cannot interrupt session with status: ${state.status}`);
    }
    this.abort(sessionId, state.jobId, 'interrupted');
    this.logOperation(sessionId, 'interrupt');
  }

  async cancel(sessionId: string): Promise<void> {
    const state = this.getState(sessionId);
    if (
      !state.jobId ||
      !this.transition(sessionId, state.jobId, 'cancelled', [
        'running',
        'paused',
        'blocked',
        'interrupted',
        'completed',
      ])
    ) {
      throw new Error(`Cannot cancel session with status: ${state.status}`);
    }
    this.abort(sessionId, state.jobId, 'cancelled');
    this.logOperation(sessionId, 'cancel');
  }

  markInterrupted(sessionId: string, runId: string): boolean {
    return this.transition(sessionId, runId, 'interrupted', ['running']);
  }

  async cleanup(sessionId: string, runId: string): Promise<void> {
    if (this.abortControllers.get(sessionId)?.runId === runId) {
      this.abortControllers.delete(sessionId);
    }
    const state = this.db.getSession(sessionId)
      ? this.db.getSessionStateDAO().get(sessionId)
      : null;
    if (
      this.controlFlags.get(sessionId)?.runId === runId &&
      (state?.jobId !== runId || (state.status !== 'running' && state.status !== 'paused'))
    ) {
      this.controlFlags.delete(sessionId);
    }
  }

  getOperations(sessionId: string): TracedOperation[] {
    return this.db.getOperationsBySession(sessionId);
  }

  async recoverRunningSessions(): Promise<string[]> {
    const sessions = await this.db.getSessionStateDAO().getSessionsByStatus('running');
    return sessions
      .filter((state) =>
        this.db
          .getSessionStateDAO()
          .transition(state.sessionId, { status: 'blocked' }, state.jobId, ['running'])
      )
      .map((state) => state.sessionId);
  }

  async initialize(): Promise<void> {
    const ids = await this.recoverRunningSessions();
    this.logger.info({ count: ids.length }, 'Recovered running Chat sessions as blocked');
  }

  private getState(sessionId: string) {
    if (!this.db.getSession(sessionId)) throw new SessionNotFoundError(sessionId);
    const state = this.db.getSessionStateDAO().get(sessionId);
    return state;
  }

  private transition(
    sessionId: string,
    runId: string,
    status: SessionStatus,
    allowedFrom: readonly SessionStatus[],
    agentState?: AgentState | null
  ): boolean {
    const changed = this.db
      .getSessionStateDAO()
      .transition(sessionId, { status, agentState }, runId, allowedFrom);
    if (
      changed &&
      status !== 'running' &&
      status !== 'paused' &&
      this.controlFlags.get(sessionId)?.runId === runId
    ) {
      this.controlFlags.delete(sessionId);
    }
    return changed;
  }

  private abort(sessionId: string, runId: string, reason: string): void {
    const active = this.abortControllers.get(sessionId);
    if (active?.runId === runId) active.controller.abort(reason);
  }

  private logOperation(sessionId: string, operation: ControlCommandType): void {
    const { traceId } = this.db.createOperation({ sessionId, operation });
    this.db.updateOperation(traceId, { status: 'success', endTime: Date.now() });
  }
}
