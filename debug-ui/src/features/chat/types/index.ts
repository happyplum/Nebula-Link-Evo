export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
  status?: 'pending' | 'running' | 'completed' | 'error';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  screenshot?: string;
  thinking?: string;
  timestamp?: number;
  created_at?: number | string;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt?: number;
  created_at?: number;
  status?: 'idle' | 'running' | 'paused' | 'blocked' | 'completed';
}

export type StreamingState = 'idle' | 'streaming' | 'paused' | 'error';
