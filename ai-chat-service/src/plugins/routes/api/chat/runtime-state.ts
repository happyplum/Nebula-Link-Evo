import { Type } from '@sinclair/typebox';
import type { ConversationManager } from '../../../../conversation/manager.js';
import type { AgentState, SessionState, SessionStatus } from '../../../../conversation/types.js';
import { ChatSessionController } from '../../../../services/chat-session-controller.js';
import type { SessionStatusResponse } from '../../../../services/chat-session-controller.js';

export const SessionStatusSchema = Type.Union([
  Type.Literal('idle'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('blocked'),
  Type.Literal('interrupted'),
  Type.Literal('cancelled'),
  Type.Literal('completed'),
]);

export const AgentStateSchema = Type.Object({
  schema_version: Type.Literal(1),
  currentTask: Type.Optional(
    Type.Object({
      description: Type.String(),
      startedAt: Type.String(),
      estimatedSteps: Type.Optional(Type.Number()),
      completedSteps: Type.Number(),
    })
  ),
  blockReason: Type.Optional(
    Type.Union([
      Type.Literal('waiting_for_user_input'),
      Type.Literal('api_error'),
      Type.Literal('rate_limit'),
      Type.Literal('validation_failed'),
      Type.Literal('timeout'),
      Type.Literal('job_error'),
    ])
  ),
  waitingFor: Type.Optional(
    Type.Union([
      Type.Literal('user_message'),
      Type.Literal('api_retry'),
      Type.Literal('external_confirmation'),
    ])
  ),
  retryCount: Type.Optional(Type.Number()),
  lastError: Type.Optional(Type.String()),
  retryAfterMs: Type.Optional(Type.Number({ minimum: 0 })),
});

export interface RuntimeSessionState {
  status: SessionStatus;
  jobId?: string;
  currentJobId?: string;
  lastActivity: string;
  agentState?: AgentState;
}

function resolveRuntimeStatus(
  controllerStatus: SessionStatusResponse,
  sessionState: SessionState | null,
  baseStatus?: SessionStatus
): SessionStatus {
  if (controllerStatus.status !== 'idle') {
    return controllerStatus.status;
  }

  return sessionState?.status ?? baseStatus ?? 'idle';
}

export function mergeRuntimeSessionState(options: {
  controllerStatus: SessionStatusResponse;
  sessionState: SessionState | null;
  baseStatus?: SessionStatus;
}): RuntimeSessionState {
  const { controllerStatus, sessionState, baseStatus } = options;

  return {
    status: resolveRuntimeStatus(controllerStatus, sessionState, baseStatus),
    jobId: sessionState?.jobId ?? controllerStatus.currentJobId,
    currentJobId: controllerStatus.currentJobId ?? sessionState?.jobId,
    lastActivity: sessionState?.lastActiveAt ?? controllerStatus.lastActivity,
    agentState: sessionState?.agentState,
  };
}

export async function getRuntimeSessionState(
  conversationManager: ConversationManager,
  sessionId: string,
  baseStatus?: SessionStatus
): Promise<RuntimeSessionState> {
  const controllerStatus = ChatSessionController.getInstance().getStatus(sessionId);
  const sessionState = await conversationManager.getSessionState(sessionId);

  return mergeRuntimeSessionState({
    controllerStatus,
    sessionState,
    baseStatus,
  });
}
