export type AgentMessageRole = 'user' | 'agent';

export interface AgentAction {
  id: string;
  label: string;
  variant: 'primary' | 'secondary' | 'danger';
  onClick: () => void;
}

export interface AgentMessage {
  id: string;
  role: AgentMessageRole;
  content: string;
  actions?: AgentAction[];
  timestamp: number;
}

export type AgentPhase =
  | 'idle'
  | 'analyzing'
  | 'exploring'
  | 'generating'
  | 'running'
  | 'completed'
  | 'failed';
