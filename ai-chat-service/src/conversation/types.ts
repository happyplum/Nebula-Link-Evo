export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageMetadata {
  [key: string]: unknown;
}

export type SessionStatus =
  'idle' | 'running' | 'paused' | 'blocked' | 'interrupted' | 'cancelled' | 'completed';

export interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  summary: string | null;
  message_count: number;
  provider: string;
  model: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
  metadata: MessageMetadata | null;
  idempotency_key?: string;
}

export interface CreateSessionParams {
  id?: string;
  title: string;
  provider: string;
  model: string;
}

export interface CreateMessageParams {
  id?: string;
  session_id: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
  idempotency_key?: string;
}

export interface UpdateSessionParams {
  title?: string;
  summary?: string | null;
  provider?: string;
  model?: string;
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
  traceId: string;
  sessionId: string;
  operation: ControlCommandType;
  startTime: number;
  endTime?: number;
  status: OperationStatus;
  error?: string;
}

export interface CreateOperationParams {
  sessionId: string;
  operation: ControlCommandType;
  status?: OperationStatus;
  error?: string;
}

export interface UpdateOperationParams {
  endTime?: number;
  status?: OperationStatus;
  error?: string;
}

export interface AgentState {
  schema_version: 1;
  currentTask?: {
    description: string;
    startedAt: string;
    estimatedSteps?: number;
    completedSteps: number;
  };
  blockReason?:
    | 'waiting_for_user_input'
    | 'api_error'
    | 'rate_limit'
    | 'validation_failed'
    | 'timeout'
    | 'job_error';
  waitingFor?: 'user_message' | 'api_retry' | 'external_confirmation';
  retryCount?: number;
  lastError?: string;
  retryAfterMs?: number;
}

export interface SessionState {
  sessionId: string;
  status: SessionStatus;
  lastActiveAt: string;
  agentState?: AgentState;
  jobId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionStateParams {
  sessionId: string;
  status?: SessionStatus;
  agentState?: AgentState;
  jobId?: string;
}

export interface UpdateSessionStateParams {
  status?: SessionStatus;
  agentState?: AgentState;
  jobId?: string;
  lastActiveAt?: string;
}
