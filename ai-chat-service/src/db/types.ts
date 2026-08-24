export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageMetadata {
  readonly [key: string]: unknown;
}

export type SessionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'interrupted'
  | 'cancelled'
  | 'completed';

export interface Session {
  readonly id: string;
  readonly title: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly summary: string | null;
  readonly message_count: number;
  readonly provider: string;
  readonly model: string;
}

export interface Message {
  readonly id: string;
  readonly session_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly created_at: string;
  readonly metadata: MessageMetadata | null;
  readonly idempotency_key?: string;
}

export interface CreateSessionParams {
  readonly id?: string;
  readonly title: string;
  readonly provider: string;
  readonly model: string;
}

export interface CreateMessageParams {
  readonly id?: string;
  readonly session_id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly metadata?: MessageMetadata;
  readonly idempotency_key?: string;
}

export interface UpdateSessionParams {
  readonly title?: string;
  readonly summary?: string | null;
  readonly provider?: string;
  readonly model?: string;
}

export interface AgentState {
  readonly schema_version: 1;
  readonly currentTask?: {
    readonly description: string;
    readonly startedAt: string;
    readonly estimatedSteps?: number;
    readonly completedSteps: number;
  };
  readonly blockReason?:
    | 'waiting_for_user_input'
    | 'api_error'
    | 'rate_limit'
    | 'validation_failed'
    | 'timeout'
    | 'job_error';
  readonly waitingFor?: 'user_message' | 'api_retry' | 'external_confirmation';
  readonly retryCount?: number;
  readonly lastError?: string;
  readonly retryAfterMs?: number;
}

export interface SessionState {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly lastActiveAt: string;
  readonly agentState?: AgentState;
  readonly jobId?: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateSessionStateParams {
  readonly sessionId: string;
  readonly status?: SessionStatus;
  readonly agentState?: AgentState;
  readonly jobId?: string;
}

export interface UpdateSessionStateParams {
  readonly status?: SessionStatus;
  readonly agentState?: AgentState;
  readonly jobId?: string;
  readonly lastActiveAt?: string;
}

export type ControlCommandType =
  | 'create'
  | 'interrupt'
  | 'cancel'
  | 'cleanup'
  | 'pause'
  | 'resume'
  | 'set_current_job'
  | 'update_metadata'
  | 'set_pause_flags'
  | 'mark_as_paused';

export type OperationStatus = 'pending' | 'success' | 'failed';

export interface TracedOperation {
  readonly traceId: string;
  readonly sessionId: string;
  readonly operation: ControlCommandType;
  readonly startTime: number;
  readonly endTime?: number;
  readonly status: OperationStatus;
  readonly error?: string;
}

export interface CreateOperationParams {
  readonly sessionId: string;
  readonly operation: ControlCommandType;
  readonly status?: OperationStatus;
  readonly error?: string;
}

export interface UpdateOperationParams {
  readonly endTime?: number;
  readonly status?: OperationStatus;
  readonly error?: string;
}
