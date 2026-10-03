import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from '../config/schema.js';
import type { ConversationManager } from './manager.js';
import type { SessionEventsDAO } from './session-events-dao.js';
import type { SessionEventHub } from './session-event-hub.js';
import type { ChatSessionController } from '../services/chat-session-controller.js';
import type { HarnessRuntime, HarnessSessionHandle } from '../harness/index.js';
import type { HarnessProjectionStore } from '../harness/projection-store.js';
import { createWorkerLogger } from '../services/logger.js';
import { chatFailureState } from '../services/chat-failure-state.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';
import { ProviderError, PROVIDER_ERRORS } from '../services/provider/errors.js';

interface ChatSendParams {
  sessionId: string;
  message: string;
  messageId?: string;
  screenshot?: string;
  skipAddMessage?: boolean;
}

export interface ChatExecution {
  runId: string;
  statusOwner: 'queue' | 'chat-handler';
}

interface ActiveChatRun {
  runId: string;
  handle?: HarnessSessionHandle;
  completion: Promise<void>;
}

/** Chat facade over the same durable DSH loop used by scoped Agent tasks. */
export class ChatHandler {
  private readonly active = new Map<string, ActiveChatRun>();
  private readonly logger = createWorkerLogger('harness-chat-handler');

  constructor(
    private readonly conversationManager: ConversationManager,
    private readonly config: ResolvedConfig,
    private readonly harness: HarnessRuntime,
    private readonly projection: HarnessProjectionStore,
    private readonly sessionEventsDAO: SessionEventsDAO,
    private readonly sessionEventHub: SessionEventHub,
    private readonly sessionController: ChatSessionController,
    private readonly runScheduler: HarnessRunScheduler,
    private readonly admitNewRun: () => void
  ) {}

  getSessionEventsDAO(): SessionEventsDAO {
    return this.sessionEventsDAO;
  }

  getSessionEventHub(): SessionEventHub {
    return this.sessionEventHub;
  }

  async handleChatSend(
    _clientId: string,
    params: ChatSendParams,
    execution: ChatExecution
  ): Promise<void> {
    if (params.screenshot) {
      throw new Error(
        'Raw chat screenshots are not accepted; use a proxy-managed VisionSnapshotBindingV1 attachment'
      );
    }
    const content = params.message.trim();
    if (!content) throw new Error('Message content is required');
    const session = this.requireSession(params.sessionId);
    const messageId = params.messageId ?? randomUUID();
    await this.startRun(params.sessionId, execution, false, async (abortSignal, setHandle) => {
      const persisted = await this.harness.revision(SessionId(params.sessionId));
      if (
        abortSignal.aborted ||
        !this.sessionController.isRunning(params.sessionId, execution.runId)
      )
        return;
      const handle = await this.harness.openSession({
        sessionId: SessionId(params.sessionId),
        route: {
          provider: session.provider,
          model: session.model,
          temperature: this.config.settings.temperature,
          maxTokens: this.config.settings.maxTokens,
        },
        resume: persisted !== undefined,
        signal: abortSignal,
        setup: restrictRawProxyOperations,
      });
      setHandle(handle);
      await this.followupAtCheckpoint(
        params.sessionId,
        execution.runId,
        handle,
        abortSignal,
        content,
        messageId
      );
    });
  }

  async resumeSession(_clientId: string, sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const revision = await this.harness.revision(SessionId(sessionId));
    if (!revision)
      throw new Error(`Cannot resume session ${sessionId}: durable Harness log not found`);
    const execution: ChatExecution = { runId: randomUUID(), statusOwner: 'chat-handler' };
    await this.startRun(sessionId, execution, true, async (abortSignal, setHandle) => {
      const handle = await this.harness.openSession({
        sessionId: SessionId(sessionId),
        route: {
          provider: session.provider,
          model: session.model,
          temperature: this.config.settings.temperature,
          maxTokens: this.config.settings.maxTokens,
        },
        resume: true,
        signal: abortSignal,
        setup: restrictRawProxyOperations,
      });
      setHandle(handle);
      await this.followupAtCheckpoint(
        sessionId,
        execution.runId,
        handle,
        abortSignal,
        '请从上次已持久化的安全边界继续。',
        randomUUID()
      );
    });
  }

  async recoverDurableProjections(): Promise<number> {
    let recovered = 0;
    for (const session of this.conversationManager.listSessions()) {
      if (this.projection.state(session.id).deleted) continue;
      const revision = await this.harness.revision(SessionId(session.id));
      if (!revision) continue;
      const state = this.projection.state(session.id);
      const durable = await this.harness.readDurable(SessionId(session.id), state.projectedDshSeq);
      const result = this.projection.catchUp(
        session.id,
        durable.durableSeq,
        durable.events,
        String(revision)
      );
      this.publish(result.publicEvents);
      if (durable.events.length > 0) recovered += 1;
    }
    return recovered;
  }

  async catchUpDurable(
    sessionId: string,
    options: { allowDeleted?: boolean; publish?: boolean } = {}
  ): Promise<string | undefined> {
    const revision = await this.harness.revision(SessionId(sessionId));
    if (!revision) return undefined;
    const state = this.projection.state(sessionId);
    const durable = await this.harness.readDurable(SessionId(sessionId), state.projectedDshSeq);
    const result = this.projection.catchUp(
      sessionId,
      durable.durableSeq,
      durable.events,
      String(revision),
      { allowDeleted: options.allowDeleted }
    );
    if (options.publish !== false) this.publish(result.publicEvents);
    return String(revision);
  }

  async cancelAndDrain(sessionId: string): Promise<void> {
    const run = this.active.get(sessionId);
    if (!run) {
      const state = await this.sessionController.getStatus(sessionId);
      if (state.jobId && state.status !== 'idle' && state.status !== 'cancelled') {
        await this.sessionController.cancel(sessionId);
      }
      if (state.jobId) await this.sessionController.cleanup(sessionId, state.jobId);
      return;
    }
    run.handle?.cancel('user');
    try {
      await this.sessionController.cancel(sessionId);
    } catch (error) {
      this.logger.debug(
        { err: error, sessionId },
        'Session controller was already settled during deletion'
      );
    }
    await run.completion;
  }

  async close(): Promise<void> {
    const runs = [...this.active.entries()];
    for (const [sessionId, run] of runs) {
      run.handle?.cancel('shutdown');
      if (this.sessionController.isRunning(sessionId, run.runId)) {
        await this.sessionController.interrupt(sessionId);
      }
    }
    await Promise.allSettled(runs.map(([, run]) => run.completion));
  }

  private async startRun(
    sessionId: string,
    execution: ChatExecution,
    resume: boolean,
    execute: (
      signal: AbortSignal,
      setHandle: (handle: HarnessSessionHandle) => void
    ) => Promise<void>
  ): Promise<void> {
    if (this.active.has(sessionId))
      throw new Error(`Session ${sessionId} already has an active Harness run`);
    const { runId, statusOwner } = execution;
    let resolveCompletion = (): void => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const active: ActiveChatRun = { runId, completion };
    this.active.set(sessionId, active);
    let scheduled = false;
    let succeeded = false;
    let failure: { error: unknown } | undefined;
    try {
      if (statusOwner === 'chat-handler') {
        this.admitNewRun();
        await this.sessionController.beginRun(sessionId, runId, resume);
      }
      const abortController = await this.sessionController.createAbortController(sessionId, runId);
      if (statusOwner === 'chat-handler') {
        this.runScheduler.enqueue({
          runId,
          ownerType: 'chat',
          ownerId: sessionId,
          messageId: runId,
        });
        scheduled = true;
        await this.runScheduler.wait(runId, abortController.signal);
      }
      if (!this.sessionController.isRunning(sessionId, runId) || abortController.signal.aborted)
        return;
      await execute(abortController.signal, (handle) => {
        active.handle = handle;
      });
      succeeded = true;
    } catch (error) {
      failure = { error };
      await this.catchUpAfterFailure(sessionId, active.handle);
      if (statusOwner === 'chat-handler') {
        this.sessionController.block(sessionId, runId, chatFailureState(error).agentState);
      }
    } finally {
      try {
        await active.handle?.dispose();
        if (succeeded && statusOwner === 'chat-handler')
          this.sessionController.complete(sessionId, runId);
      } catch (disposeError) {
        if (succeeded) {
          if (statusOwner === 'chat-handler')
            this.sessionController.block(
              sessionId,
              runId,
              chatFailureState(disposeError).agentState
            );
          failure = { error: disposeError };
        }
        if (!succeeded) {
          this.logger.error(
            { err: disposeError, sessionId },
            'Failed to release Harness handle after Chat failure'
          );
        }
      } finally {
        try {
          if (scheduled) this.runScheduler.complete(runId);
          await this.sessionController.cleanup(sessionId, runId);
        } finally {
          if (this.active.get(sessionId)?.runId === runId) this.active.delete(sessionId);
          resolveCompletion();
        }
      }
    }
    if (failure) throw failure.error;
  }

  private async catchUpAfterFailure(
    sessionId: string,
    handle: HarnessSessionHandle | undefined
  ): Promise<void> {
    if (!handle) return;
    try {
      await this.flushAndProject(sessionId, handle);
    } catch (projectionError) {
      this.logger.error(
        { err: projectionError, sessionId },
        'Failed to catch up durable Harness events after Chat failure'
      );
    }
  }

  private async flushAndProject(sessionId: string, handle: HarnessSessionHandle): Promise<void> {
    const durableSeq = await handle.flush();
    const revision = await this.harness.revision(SessionId(sessionId));
    if (!revision) throw new Error(`Harness flush for ${sessionId} produced no durable revision`);
    const state = this.projection.state(sessionId);
    const durable = await this.harness.readDurable(SessionId(sessionId), state.projectedDshSeq);
    if (durable.durableSeq !== durableSeq) {
      throw new Error(
        `Harness durable seq changed during projection for ${sessionId}: flushed ${durableSeq}, read ${durable.durableSeq}`
      );
    }
    const result = this.projection.catchUp(sessionId, durableSeq, durable.events, String(revision));
    this.publish(result.publicEvents);
  }

  private publish(
    events: readonly import('@nebula-link-evo/shared/types/agent-stream').AgentStreamEventV1[]
  ): void {
    for (const event of events) this.sessionEventHub.publish(event.streamId, event);
  }

  private applyPauseCheckpoint(sessionId: string, runId: string): void {
    if (this.sessionController.shouldPause(sessionId, runId, 'afterGeneration')) {
      this.sessionController.markAsPaused(sessionId, runId);
    }
  }

  private async followupAtCheckpoint(
    sessionId: string,
    runId: string,
    handle: HarnessSessionHandle,
    signal: AbortSignal,
    text: string,
    messageId: string
  ): Promise<void> {
    const cancel = (): void => handle.cancel('user');
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      if (signal.aborted || !this.sessionController.isRunning(sessionId, runId)) return;
      const fromSeq = handle.events().length;
      await handle.followup(text, messageId);
      await this.flushAndProject(sessionId, handle);
      // Only this invocation's freshly flushed suffix may settle its lifecycle.
      const terminal = handle
        .events(fromSeq)
        .filter((event) => event.type === 'turn/end')
        .at(-1);
      if (terminal?.type === 'turn/end') {
        const reason = terminal.data.reason;
        if (reason.kind === 'error') {
          if (reason.error.code === PROVIDER_ERRORS.RATE_LIMITED) {
            throw new ProviderError(
              PROVIDER_ERRORS.RATE_LIMITED,
              this.requireSession(sessionId).provider,
              undefined,
              reason.error.message
            );
          }
          throw Object.assign(new Error(reason.error.message), { code: reason.error.code });
        }
        if (reason.kind === 'blocked') this.sessionController.markAsPaused(sessionId, runId);
        if (reason.kind === 'aborted' || reason.kind === 'interrupted')
          this.sessionController.markInterrupted(sessionId, runId);
      }
      this.applyPauseCheckpoint(sessionId, runId);
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }

  private requireSession(sessionId: string) {
    const session = this.conversationManager.getSession(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    if (this.projection.state(sessionId).deleted) {
      throw new Error(`Session ${sessionId} is being deleted`);
    }
    return session;
  }
}

function restrictRawProxyOperations(agentContext: import('@deepseek-ai/cordis').Context): void {
  const rawOperations = agentContext.tools
    .schemas()
    .map((tool) => tool.name)
    .filter((name) => /(?:operation_execute|operation_get|operation_cancel)$/u.test(name));
  if (rawOperations.length > 0) agentContext.tools.restrict({ deny: rawOperations });
}
