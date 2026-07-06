/**
 * Stream Persistence Worker Types
 *
 * Types for IPC communication between main thread and worker thread
 * for streaming buffer persistence.
 */

/**
 * A chunk of stream data to be persisted
 */
export interface StreamChunk {
  index: number;
  type: string;
  text: string;
  version: number;
  timestamp: string;
}

/**
 * Request sent from main thread to worker
 */
export interface PersistRequest {
  id: string;
  sessionId: string;
  chunks: StreamChunk[];
}

/**
 * Response sent from worker to main thread
 */
export interface PersistResponse {
  id: string;
  success: boolean;
  error?: string;
}
