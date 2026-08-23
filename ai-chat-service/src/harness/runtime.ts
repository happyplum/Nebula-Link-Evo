import { Context } from '@deepseek-ai/cordis';
import Timer from '@deepseek-ai/cordis-plugin-timer';
import LlmRuntime, { CallId, MessageId, createUserMessage, freezeMessage } from '@deepseek-ai/dsh-llm';
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session';
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import * as llmRetry from '@deepseek-ai/dsh-llm-retry';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic';
import ToolResultPruner from '@deepseek-ai/dsh-compaction-tool-result-pruner';
import SkillRegistry from '@deepseek-ai/dsh-skill';
import * as toolSkill from '@deepseek-ai/dsh-tool-skill';
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local';
import * as timeoutPolicy from '@deepseek-ai/dsh-tool-call-timeout-policy';
import ApprovalService from '@deepseek-ai/dsh-user-approval';
import * as checkpointPolicy from '@deepseek-ai/dsh-session-checkpoint-policy';
import InvariantRegistry from '@deepseek-ai/dsh-invariants';
import * as sessionInvariant from '@deepseek-ai/dsh-session/invariant';
import * as agentInvariant from '@deepseek-ai/dsh-agent/invariant';
import * as scopeInvariant from '@deepseek-ai/dsh-scope/invariant';
import * as agentLoopInvariant from '@deepseek-ai/dsh-agent-loop/invariant';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import * as piAi from '@deepseek-ai/dsh-llm-pi-ai';
import * as mcpClient from '@deepseek-ai/dsh-mcp-client';
import type { AgentCancelCause, AgentHandle } from '@deepseek-ai/dsh-agent';
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type {
  HarnessRuntime,
  HarnessRuntimeOptions,
  HarnessSessionHandle,
  OpenHarnessSessionOptions,
} from './types.js';
import { NebulaGlmLlmAdapter } from './glm-adapter.js';
import { loadTrustedHarnessPlugins } from './trusted-plugin-loader.js';
import { createHash, randomUUID } from 'node:crypto';

const CANCEL_CAUSES: Record<'user' | 'timeout' | 'shutdown', AgentCancelCause> = {
  user: { kind: 'user' },
  timeout: { kind: 'hook', reason: 'timeout' },
  shutdown: { kind: 'disposed' },
};

export async function createHarnessRuntime(options: HarnessRuntimeOptions): Promise<HarnessRuntime> {
  const context = new Context();
  const transportContext = context.isolate('tools');
  let disposed = false;
  try {
    await context.plugin(Timer);
    await context.plugin(LlmRuntime);
    await context.plugin(SessionStore);
    await context.plugin(JsonlSessionPersistence, {
      root: options.sessionRoot,
      compression: 'zstd',
      packChunks: true,
    });
    await context.plugin(LocalAttachmentStore, { dshHome: options.attachmentRoot });
    await context.plugin(SystemPrompt, {
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      persona: options.persona,
    });
    await context.plugin(ApprovalService, { policy: 'never' });
    await context.plugin(ToolRuntime, { mode: 'native' });
    await transportContext.plugin(ToolRuntime, { mode: 'native' });
    await transportContext.plugin(timeoutPolicy);
    await context.plugin(AgentRegistry);
    await context.plugin(llmRetry);
    await context.plugin(TokenMeter);
    await context.plugin(BasicCompactionEngine, { auto: true });
    await context.plugin(ToolResultPruner);
    await context.plugin(SkillRegistry);
    await context.plugin(toolSkill);
    await context.plugin(timeoutPolicy);
    await context.plugin(checkpointPolicy);
    await context.plugin(InvariantRegistry);
    await context.plugin(sessionInvariant);
    await context.plugin(agentInvariant);
    await context.plugin(scopeInvariant);
    await context.plugin(agentLoopInvariant);
    await context.plugin(piAi, options.piAi);
    if (options.glm) {
      context.llm.registerAdapter(
        [options.glm.provider],
        new NebulaGlmLlmAdapter({
          ...options.glm,
          attachments: () => context.attachments,
        })
      );
    }
    await options.configure?.(context);
    if (options.trustedPlugins) {
      await loadTrustedHarnessPlugins(context, {
        ...options.trustedPlugins,
        mcp: options.mcp,
      });
    }
    for (const server of options.mcp) await transportContext.plugin(mcpClient, server);
    await context.plugin(AgentLoop, {
      agents: [],
      maxParallelToolCalls: options.maxParallelToolCalls,
    });
  } catch (error) {
    await context.fiber.dispose();
    throw error;
  }

  const assertOpen = (): void => {
    if (disposed) throw new Error('Harness runtime is disposed');
  };

  return {
    context,
    async openSession(openOptions) {
      assertOpen();
      return openHarnessSession(context, openOptions);
    },
    stream(generateOptions) {
      assertOpen();
      return context.llm.stream(generateOptions);
    },
    async inspect(sessionId, fromSeq = 0) {
      assertOpen();
      const stored = await context.sessionPersistence.readFrom(sessionId, fromSeq);
      return stored.events;
    },
    async readDurable(sessionId, fromSeq = 0) {
      assertOpen();
      if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) {
        throw new TypeError('fromSeq must be a non-negative safe integer');
      }
      const stored = await context.sessionPersistence.readFrom(sessionId, 0);
      const durableSeq = stored.events.length;
      if (fromSeq > durableSeq) {
        throw new Error(
          `Projection cursor ${fromSeq} exceeds durable DSH seq ${durableSeq} for ${sessionId}`
        );
      }
      return { durableSeq, events: stored.events.slice(fromSeq) };
    },
    async revision(sessionId) {
      assertOpen();
      return (await context.sessionPersistence.listSnapshots()).find(
        (snapshot) => snapshot.header.id === sessionId
      )?.revision;
    },
    async purge(sessionId, expectedRevision) {
      assertOpen();
      return context.sessionPersistence.purge(sessionId, expectedRevision);
    },
    async callTool(serverName, toolName, args = {}, callOptions = {}) {
      assertOpen();
      const signal = callOptions.signal ?? new AbortController().signal;
      const result = await transportContext.tools.execute({
        callId: CallId(randomUUID()),
        name: publicMcpToolName(serverName, toolName),
        arguments: args,
        signal,
      });
      if (result.isError) {
        throw new Error(result.error.message);
      }
      return result.value;
    },
    transportToolNames() {
      assertOpen();
      return Object.freeze(transportContext.tools.schemas().map((tool) => tool.name));
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const agent of context.agents.list()) agent.cancel(CANCEL_CAUSES.shutdown);
      await Promise.allSettled(context.agents.list().map((agent) => agent.whenIdle()));
      await Promise.allSettled(
        context.sessions.list().map((session) => context.sessions.flush(session))
      );
      await context.fiber.dispose();
    },
  };
}

async function openHarnessSession(
  context: Context,
  options: OpenHarnessSessionOptions
): Promise<HarnessSessionHandle> {
  const agentOptions = {
    provider: options.route.provider,
    model: options.route.model,
    ...(options.route.maxTokens !== undefined ? { maxTokens: options.route.maxTokens } : {}),
  };
  const handle = options.resume
    ? await context.agents.resume({
        resumeSessionId: options.sessionId,
        agentOptions,
        ...(options.setup ? { setup: options.setup } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      })
    : await context.agents.create({
        sessionId: options.sessionId,
        meta: { cwd: process.cwd() },
        agentOptions,
        ...(options.setup ? { setup: options.setup } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      });

  installRequestDefaults(handle, options);
  return sessionHandle(context, handle);
}

function installRequestDefaults(handle: AgentHandle, options: OpenHarnessSessionOptions): void {
  if (options.route.temperature === undefined) return;
  handle.agent.ctx.on('agent/request', async (_payload, next) => ({
    ...(await next()),
    temperature: options.route.temperature,
  }));
}

function sessionHandle(context: Context, handle: AgentHandle): HarnessSessionHandle {
  let released = false;
  return {
    handle,
    async followup(text, messageId) {
      if (released) throw new Error('Harness session is disposed');
      const message = messageId
        ? freezeMessage({
            id: MessageId(messageId),
            role: 'user' as const,
            content: [{ type: 'text' as const, text }],
            source: { kind: 'user' as const },
          })
        : createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } });
      handle.agent.followup(message);
      await handle.agent.whenIdle();
    },
    cancel(cause = 'user') {
      if (!released) handle.agent.cancel(CANCEL_CAUSES[cause]);
    },
    async flush() {
      if (released) throw new Error('Harness session is disposed');
      await context.sessions.flush(handle.agent.session);
      return handle.agent.session.seq;
    },
    events(fromSeq = 0): readonly SessionEvent[] {
      if (!Number.isSafeInteger(fromSeq) || fromSeq < 0) {
        throw new TypeError('fromSeq must be a non-negative safe integer');
      }
      return handle.agent.session.events.slice(fromSeq);
    },
    async dispose() {
      if (released) return;
      released = true;
      await handle.dispose();
    },
  };
}

export { SessionId };

function publicMcpToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/gu, '_');
  if (normalized === joined && normalized.length <= 64) return normalized;
  const hash = createHash('sha256')
    .update(`${serverName}\0${rawName}`)
    .digest('hex')
    .slice(0, 12);
  return `${normalized.slice(0, 51)}_${hash}`;
}
