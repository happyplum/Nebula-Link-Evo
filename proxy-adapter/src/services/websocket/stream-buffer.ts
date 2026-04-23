import type { StreamChunk } from './types.js';
import { getPersistWorker, getPersistenceManager } from './persistence-singletons.js';
import { createWorkerLogger } from '../logger.js';

const logger = createWorkerLogger('StreamBuffer');

export class StreamBuffer {
  private chunks: StreamChunk[] = [];
  private readonly maxSize = 1000;
  private nextIndex = 0;

  constructor(private readonly sessionId: string) {}

  async addChunk(chunk: StreamChunk): Promise<void> {
    const index = this.nextIndex++;
    this.chunks.push({ ...chunk });
    if (this.chunks.length > this.maxSize) this.chunks.shift();
    try {
      const persistenceChunk = { index, type: chunk.type, text: chunk.content, version: 1, timestamp: chunk.timestamp || new Date().toISOString() };
      await getPersistWorker().persist(this.sessionId, [persistenceChunk]);
    } catch (error) {
      logger.error({ err: error }, 'Failed to persist chunk');
    }
  }
  getBuffer(): StreamChunk[] { return [...this.chunks]; }
  clear(): void { this.chunks = []; }
  loadFromDisk(fromIndex: number = 0): StreamChunk[] {
    const loadedChunks = getPersistenceManager().loadFromDisk(this.sessionId, fromIndex).map((c) => ({ type: c.type, content: c.text, timestamp: c.timestamp }));
    const memoryChunks = this.chunks.slice(loadedChunks.length).map((chunk) => ({ ...chunk, timestamp: chunk.timestamp || new Date().toISOString() }));
    return [...loadedChunks, ...memoryChunks];
  }
  getLastPersistedIndex(): number { return getPersistenceManager().getLastChunkIndex(this.sessionId); }
}
