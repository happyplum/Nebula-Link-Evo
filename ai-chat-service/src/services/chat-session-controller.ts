import { DatabaseManager } from '../conversation/db.js';
import type { TracedOperation, ControlCommandType, SessionStatus } from '../conversation/types.js';
import type { Logger } from 'pino';
import { createWorkerLogger } from './logger.js';

export interface OperationTrace {
  traceId: string;
  sessionId: string;
}

export class SessionNotFoundError extends Error {
  constructor(public sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
  }
}

export interface SessionStatusResponse {
  sessionId: string;
  status: SessionStatus;
  currentJobId?: string;
  lastActivity: string; // ISO timestamp
}

export interface SessionMetadata {
  currentJobId?: string;
  lastActivity: string;
  pauseRequested?: boolean;
  pauseAfterGeneration?: boolean;
  pauseAfterExecution?: boolean;
}

interface CreateAbortControllerOptions {
  activateSession?: boolean;
}

export class ChatSessionController {
  private static instance: ChatSessionController;
  private abortControllers = new Map<string, AbortController>();
  private sessionStatuses = new Map<string, SessionStatus>();
  private sessionMetadata = new Map<string, SessionMetadata>();
  private logger: Logger;

  private constructor(logger?: Logger) {
    this.logger = logger ?? createWorkerLogger('ChatSessionController');
  }

  static getInstance(): ChatSessionController {
    if (!ChatSessionController.instance) {
      ChatSessionController.instance = new ChatSessionController();
    }
    return ChatSessionController.instance;
  }

  /**
   * Get current status of a session
   */
  getStatus(sessionId: string): SessionStatusResponse {
    const status = this.sessionStatuses.get(sessionId) || 'idle';
    const metadata = this.sessionMetadata.get(sessionId) || { lastActivity: new Date().toISOString() };

    return {
      sessionId,
      status,
      currentJobId: metadata.currentJobId,
      lastActivity: metadata.lastActivity,
    };
  }

  /**
    * Set current job ID for a session
    */
  setCurrentJobId(sessionId: string, jobId: string): void {
    const traceId = this.logOperation(sessionId, 'set_current_job');
    const metadata = this.sessionMetadata.get(sessionId) || { lastActivity: new Date().toISOString() };
    metadata.currentJobId = jobId;
    metadata.lastActivity = new Date().toISOString();
    this.sessionMetadata.set(sessionId, metadata);
    this.log(sessionId, `Set current job ID: ${jobId}`, traceId);
  }

  /**
    * Update session metadata
    */
  updateMetadata(sessionId: string, updates: Partial<SessionMetadata>): void {
    const traceId = this.logOperation(sessionId, 'update_metadata');
    const metadata = this.sessionMetadata.get(sessionId) || { lastActivity: new Date().toISOString() };
    const updated = { ...metadata, ...updates, lastActivity: new Date().toISOString() };
    this.sessionMetadata.set(sessionId, updated);
    this.log(sessionId, `Updated metadata: ${JSON.stringify(updates)}`, traceId);
  }

  /**
      * Create a new AbortController for a session and set its status to running
      */
  createAbortController(
    sessionId: string,
    options: CreateAbortControllerOptions = {}
  ): AbortController {
    const { activateSession = true } = options;
    const controller = new AbortController();
    this.abortControllers.set(sessionId, controller);
    this.sessionStatuses.set(sessionId, 'running');

    const db = DatabaseManager.getInstance();
    if (activateSession) {
      db.activateSession(sessionId);
    }

    const traceId = this.logOperation(sessionId, 'create');
    this.log(
      sessionId,
      `Created AbortController, status: running${activateSession ? '' : ' (activation skipped)'}`,
      traceId
    );
    return controller;
  }

  /**
    * Request to pause a running session (wait-to-complete semantics)
    */
  async pause(sessionId: string): Promise<void> {
    const statusData = this.getStatus(sessionId);
    const status = statusData.status;

    if (status !== 'running') {
      const traceId = this.logOperation(sessionId, 'pause');
      this.log(sessionId, `Cannot pause, current status: ${status}`, traceId);
      throw new Error(`Cannot pause session with status: ${status}`);
    }

    const traceId = this.logOperation(sessionId, 'pause');
    this.updateMetadata(sessionId, { pauseRequested: true });
    this.log(sessionId, 'Pause requested (wait-to-complete)', traceId);
  }

  /**
      * Mark session as actually paused (called from checkpoints)
      */
  markAsPaused(sessionId: string): void {
    const traceId = this.logOperation(sessionId, 'mark_as_paused');
    this.sessionStatuses.set(sessionId, 'paused');
    this.updateMetadata(sessionId, { pauseRequested: false });
    const db = DatabaseManager.getInstance();
    db.updateSessionStatus(sessionId, 'paused');
    this.log(sessionId, 'Session is now paused', traceId);
  }

  /**
      * Resume a paused session
      */
  resume(sessionId: string, fallbackStatus?: SessionStatus): void {
    const status = this.sessionStatuses.get(sessionId) ?? fallbackStatus ?? 'idle';

    if (status !== 'paused' && status !== 'blocked') {
      const traceId = this.logOperation(sessionId, 'resume');
      this.log(sessionId, `Cannot resume, current status: ${status}`, traceId);
      throw new Error(`Cannot resume session with status: ${status}`);
    }

    const traceId = this.logOperation(sessionId, 'resume');
    this.sessionStatuses.set(sessionId, 'running');
    const metadata = this.sessionMetadata.get(sessionId) || { lastActivity: new Date().toISOString() };
    this.sessionMetadata.set(sessionId, {
      ...metadata,
      pauseRequested: false,
      lastActivity: new Date().toISOString(),
    });
    const db = DatabaseManager.getInstance();
    db.updateSessionStatus(sessionId, 'running');
    this.log(sessionId, 'Session resumed', traceId);
  }

  /**
    * Set pause flags
    */
  setPauseFlags(sessionId: string, flags: { pauseAfterGeneration?: boolean; pauseAfterExecution?: boolean }): void {
    const traceId = this.logOperation(sessionId, 'set_pause_flags');
    this.updateMetadata(sessionId, flags);
    this.log(sessionId, `Pause flags updated: ${JSON.stringify(flags)}`, traceId);
  }

  /**
    * Check if session should pause
    */
  shouldPause(sessionId: string, point: 'afterGeneration' | 'afterExecution'): boolean {
    const metadata = this.sessionMetadata.get(sessionId);
    if (!metadata) return false;

    if (metadata.pauseRequested) return true;
    if (point === 'afterGeneration' && metadata.pauseAfterGeneration) return true;
    if (point === 'afterExecution' && metadata.pauseAfterExecution) return true;

    return false;
  }

  /**
      * Interrupt a running session
      */
  async interrupt(sessionId: string): Promise<void> {
    const statusData = this.getStatus(sessionId);
    const status = statusData.status;

    if (status !== 'running') {
      const traceId = this.logOperation(sessionId, 'interrupt');
      this.log(sessionId, `Cannot interrupt, current status: ${status}`, traceId);
      throw new Error(`Cannot interrupt session with status: ${status}`);
    }

    const traceId = this.logOperation(sessionId, 'interrupt');
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort('interrupted');
      this.sessionStatuses.set(sessionId, 'interrupted');
      const db = DatabaseManager.getInstance();
      db.updateSessionStatus(sessionId, 'interrupted');
      this.log(sessionId, 'Interrupted', traceId);
    }
  }

  /**
      * Cancel a running or interrupted session
      */
  async cancel(sessionId: string): Promise<void> {
    const statusData = this.getStatus(sessionId);
    const status = statusData.status;

    if (status === 'idle' || status === 'cancelled') {
      const traceId = this.logOperation(sessionId, 'cancel');
      this.log(sessionId, `Cannot cancel, current status: ${status}`, traceId);
      throw new Error(`Cannot cancel session with status: ${status}`);
    }

    const traceId = this.logOperation(sessionId, 'cancel');
    const controller = this.abortControllers.get(sessionId);
    if (controller) {
      controller.abort('cancelled');
    }

    this.sessionStatuses.set(sessionId, 'cancelled');
    const db = DatabaseManager.getInstance();
    db.updateSessionStatus(sessionId, 'cancelled');
    this.log(sessionId, 'Cancelled', traceId);
  }

  /**
      * Clean up a session, resetting its status to idle
      */
  cleanup(sessionId: string): void {
    const status = this.sessionStatuses.get(sessionId);
    if (status === 'paused') {
      const traceId = this.logOperation(sessionId, 'cleanup');
      this.log(sessionId, 'Skipping cleanup, session is paused', traceId);
      return;
    }
    const traceId = this.logOperation(sessionId, 'cleanup');
    this.abortControllers.delete(sessionId);
    this.sessionStatuses.set(sessionId, 'idle');
    const db = DatabaseManager.getInstance();
    db.updateSessionStatus(sessionId, 'idle');
    this.log(sessionId, 'Cleaned up, status: idle', traceId);
  }

  /**
    * Helper for operation logging with simplified TraceID
    */
  private log(sessionId: string, message: string, traceId?: string): void {
    const displayTraceId = traceId || sessionId.substring(0, 8);
    this.logger.info({ sessionId, traceId: displayTraceId }, message);
  }

  /**
    * Log an operation asynchronously
    * Returns the traceId for tracking
    */
  private logOperation(sessionId: string, operationType: ControlCommandType): string {
    const db = DatabaseManager.getInstance();
    const tracedOperation = db.createOperation({ sessionId, operation: operationType });

    const traceId = tracedOperation.traceId;
    Promise.resolve().then(() => {
      try {
        db.updateOperation(traceId, { status: 'success', endTime: Date.now() });
      } catch (err) {
        this.logger.error({ err, traceId }, 'Failed to update operation trace');
      }
    });

    return traceId;
  }

  /**
     * Get operation history for a session
     */
  getOperations(sessionId: string): TracedOperation[] {
    const db = DatabaseManager.getInstance();
    return db.getOperationsBySession(sessionId);
  }

  /**
     * Recover running sessions on startup
     * Changes status from 'running' to 'blocked' with reason 'process_restart'
     */
  recoverRunningSessions(): string[] {
    const db = DatabaseManager.getInstance();
    const recoveredSessions = db.recoverRunningSessions();

    const recoveredSessionIds: string[] = [];
    for (const session of recoveredSessions) {
      recoveredSessionIds.push(session.id);
      this.logger.info({ sessionId: session.id }, 'Session marked as blocked (process restart)');

      // Update in-memory state
      this.sessionStatuses.set(session.id, 'blocked');
      const metadata = this.sessionMetadata.get(session.id) || { lastActivity: new Date().toISOString() };
      this.sessionMetadata.set(session.id, { ...metadata, lastActivity: new Date().toISOString() });
    }

    return recoveredSessionIds;
  }

  /**
     * Initialize the controller and recover running sessions
     * Call this on application startup
     */
  initialize(): void {
    this.logger.info('Initializing');
    const recoveredIds = this.recoverRunningSessions();

    if (recoveredIds.length > 0) {
      this.logger.info({ count: recoveredIds.length }, 'Recovered sessions from crash');
      this.logger.debug({ ids: recoveredIds }, 'Recovered sessions from crash (full IDs)');
    } else {
      this.logger.info('No crashed sessions to recover');
    }
  }
}
