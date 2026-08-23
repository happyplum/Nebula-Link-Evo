import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { ResolvedConfig } from '../config/schema.js';
import type { MCPSDKClient } from '../clients/mcp/sdk-client.js';
import type { ConversationManager } from './manager.js';
import type { SessionEventsDAO } from './session-events-dao.js';
import type { SessionEventHub } from './session-event-hub.js';
import type { ChatSessionController } from '../services/chat-session-controller.js';
import type { HarnessRuntime, HarnessSessionHandle } from '../harness/index.js';
import type { HarnessProjectionStore } from '../harness/projection-store.js';
import { createWorkerLogger } from '../services/logger.js';

interface ChatSendParams {
  sessionId: string;
  message: string;
  messageId?: string;
  screenshot?: string;
  skipAddMessage?: boolean;
}

interface ActiveChatRun {
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
    private readonly sessionController: ChatSessionController
  ) {}

  getSessionEventsDAO(): SessionEventsDAO {
    return this.sessionEventsDAO;
  }

  getSessionEventHub(): SessionEventHub {
    return this.sessionEventHub;
  }

  /** Retained for source compatibility while MCP ownership moves into Cordis scopes. */
  setMCPClient(_client: MCPSDKClient): void {}

  async handleChatSend(_clientId: string, params: ChatSendParams): Promise<void> {
    if (params.screenshot) {
      throw new Error(
        'Raw chat screenshots are not accepted; use a proxy-managed VisionSnapshotBindingV1 attachment'
      );
    }
    const content = params.message.trim();
    if (!content) throw new Error('Message content is required');
    const session = this.requireSession(params.sessionId);
    const messageId = params.messageId ?? randomUUID();
    await this.startRun(params.sessionId, async (abortSignal, setHandle) => {
      const persisted = await this.harness.revision(SessionId(params.sessionId));
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
      try {
        await handle.followup(content, messageId);
        await this.flushAndProject(params.sessionId, handle);
      } finally {
        await handle.dispose();
      }
    });
  }

  async resumeSession(_clientId: string, sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    const revision = await this.harness.revision(SessionId(sessionId));
    if (!revision) throw new Error(`Cannot resume session ${sessionId}: durable Harness log not found`);
    await this.startRun(sessionId, async (abortSignal, setHandle) => {
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
      try {
        await handle.followup('请从上次已持久化的安全边界继续。', randomUUID());
        await this.flushAndProject(sessionId, handle);
      } finally {
        await handle.dispose();
      }
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
    if (!run) return;
    run.handle?.cancel('user');
    try {
      await this.sessionController.cancel(sessionId);
    } catch (error) {
      this.logger.debug({ err: error, sessionId }, 'Session controller was already settled during deletion');
    }
    await run.completion;
  }

  async close(): Promise<void> {
    for (const run of this.active.values()) run.handle?.cancel('shutdown');
    await Promise.allSettled([...this.active.values()].map((run) => run.completion));
  }

  private async startRun(
    sessionId: string,
    execute: (
      signal: AbortSignal,
      setHandle: (handle: HarnessSessionHandle) => void
    ) => Promise<void>
  ): Promise<void> {
    if (this.active.has(sessionId)) throw new Error(`Session ${sessionId} already has an active Harness run`);
    const abortController = this.sessionController.createAbortController(sessionId);
    let resolveCompletion = (): void => {};
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const active: ActiveChatRun = { completion };
    this.active.set(sessionId, active);
    try {
      await execute(abortController.signal, (handle) => {
        active.handle = handle;
      });
    } catch (error) {
      await this.catchUpAfterFailure(sessionId, active.handle);
      throw error;
    } finally {
      resolveCompletion();
      this.active.delete(sessionId);
      this.sessionController.cleanup(sessionId);
    }
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
    const result = this.projection.catchUp(
      sessionId,
      durableSeq,
      durable.events,
      String(revision)
    );
    this.publish(result.publicEvents);
  }

  private publish(events: readonly import('@nebula-link-evo/shared').SessionEvent[]): void {
    for (const event of events) this.sessionEventHub.publish(event.sessionId, event);
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
