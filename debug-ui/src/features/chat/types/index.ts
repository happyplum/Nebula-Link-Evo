export interface ChatSession {
  id: string;
  title: string;
  created_at?: string;
  status?: 'idle' | 'running' | 'paused' | 'blocked' | 'completed';
}

export type StreamingState = 'idle' | 'streaming' | 'paused' | 'blocked' | 'error';
