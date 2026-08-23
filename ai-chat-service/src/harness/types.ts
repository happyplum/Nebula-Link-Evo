import type { Context } from '@deepseek-ai/cordis';
import type { AgentHandle, AgentSetup } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
import type { Config as PiAiConfig } from '@deepseek-ai/dsh-llm-pi-ai';
import type { Config as DshMcpConfig } from '@deepseek-ai/dsh-mcp-client';
import type { SessionPersistenceRevision } from '@deepseek-ai/dsh-session-persistence';
import type { NebulaGlmAdapterOptions } from './glm-adapter.js';

export interface HarnessModelRoute {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface HarnessRuntimeConfig {
  sessionRoot: string;
  attachmentRoot: string;
  persona: string;
  maxParallelToolCalls: number;
  piAi: PiAiConfig;
  glm?: Omit<NebulaGlmAdapterOptions, 'attachments'>;
  decision: HarnessModelRoute;
  vision?: HarnessModelRoute;
  mcp: DshMcpConfig[];
}

export interface HarnessRuntimeOptions extends HarnessRuntimeConfig {
  configure?: (ctx: Context) => void | Promise<void>;
  trustedPlugins?: {
    packageRoot: string;
    lockPath: string;
  };
}

export interface OpenHarnessSessionOptions {
  sessionId: SessionId;
  route: HarnessModelRoute;
  setup?: AgentSetup;
  resume?: boolean;
  signal?: AbortSignal;
}

export interface HarnessSessionHandle {
  readonly handle: AgentHandle;
  followup(text: string, messageId?: string): Promise<void>;
  cancel(cause?: 'user' | 'timeout' | 'shutdown'): void;
  flush(): Promise<number>;
  events(fromSeq?: number): readonly SessionEvent[];
  dispose(): Promise<void>;
}

export interface HarnessRuntime {
  readonly context: Context;
  openSession(options: OpenHarnessSessionOptions): Promise<HarnessSessionHandle>;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  inspect(sessionId: SessionId, fromSeq?: number): Promise<readonly SessionEvent[]>;
  readDurable(
    sessionId: SessionId,
    fromSeq?: number
  ): Promise<{ durableSeq: number; events: readonly SessionEvent[] }>;
  revision(sessionId: SessionId): Promise<SessionPersistenceRevision | undefined>;
  purge(sessionId: SessionId, expectedRevision: SessionPersistenceRevision): Promise<boolean>;
  callTool(
    serverName: string,
    toolName: string,
    args?: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<unknown>;
  transportToolNames(): readonly string[];
  dispose(): Promise<void>;
}

export type HarnessMcpCaller = Pick<HarnessRuntime, 'callTool'>;
