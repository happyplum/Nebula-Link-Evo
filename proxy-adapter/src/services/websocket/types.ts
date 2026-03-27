export interface WebSocketMessage { type: string; [key: string]: unknown }
export interface StreamChunk { type: string; content: string; timestamp: string }
export type { PersistStreamChunk } from '../stream-buffer-persistence.js';
