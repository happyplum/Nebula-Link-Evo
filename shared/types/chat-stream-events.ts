/**
 * Chat Stream Event Types
 * Shared between frontend and backend for SSE streaming
 */

export enum ChatStreamEventType {
  Start = 'chat_stream_start',
  Token = 'chat_stream_token',
  Thinking = 'chat_stream_thinking',
  ToolCall = 'chat_stream_tool_call',
  ToolResult = 'chat_stream_tool_result',
  Warning = 'chat_stream_warning',
  End = 'chat_stream_end',
  Error = 'chat_stream_error'
}

export interface ChatStreamEvent {
  type: ChatStreamEventType;
  sessionId?: string;
  messageId?: string;
  text?: string;
  content?: string;
  toolCall?: {
    function?: {
      name: string;
    };
  };
  error?: string;
  data?: unknown;
}
