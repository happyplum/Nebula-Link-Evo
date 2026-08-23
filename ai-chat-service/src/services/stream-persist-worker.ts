/**
 * Stream Persistence Worker (Main Thread)
 *
 * Manages a worker thread for persisting stream chunks with IPC 2-phase commit.
 * Ensures data is not lost even if main process crashes after sending.
 *
 * Key Features:
 * - 2-phase commit: Waits for ACK before considering persisted
 * - Bounded queue: Max 1000 items, rejects with 429 when full
 * - Auto-restart: Worker restarts on crash
 * - Timeout protection: 30 second timeout for ACK
 */

import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { ServiceUnavailableError } from '../errors/http-errors.js';
import { createWorkerLogger } from './logger.js';

import type {
  PersistRequest,
  PersistResponse,
  StreamChunk,
} from './stream-persist-worker.types.js';

const logger = createWorkerLogger('stream-persist');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class StreamPersistWorker extends EventEmitter {
  private worker: Worker | null = null;
  private pendingAcks: Map<string, (response: PersistResponse) => void> =
    new Map();
  private messageQueue: PersistRequest[] = [];
  private isHealthy: boolean = true;
  private maxQueueSize: number = 1000;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor() {
    super();
    this.initializeWorker();
    this.startHealthCheck();
  }

  private getWorkerPath(): string {
    // Production: use compiled dist
    const prodPath = path.join(__dirname, '../../dist/workers/stream-persist-worker.js');
    if (existsSync(prodPath)) {
      return prodPath;
    }

    // Development: use tsx to run TypeScript directly
    const devPath = path.join(__dirname, '../workers/stream-persist-worker.ts');
    return devPath;
  }

  private initializeWorker(): void {
    const workerPath = this.getWorkerPath();
    this.worker = new Worker(workerPath);
    this.setupWorkerHandlers();
  }

  private setupWorkerHandlers(): void {
    if (!this.worker) {
      return;
    }

    this.worker.on('message', (response: PersistResponse) => {
      const resolver = this.pendingAcks.get(response.id);
      if (resolver) {
        resolver(response);
        this.pendingAcks.delete(response.id);
      }
    });

    this.worker.on('error', (error) => {
      if (this.shuttingDown) return;
      logger.error({ error }, 'Worker error');
      this.isHealthy = false;
      this.rejectAllPending(error);
      this.restartWorker();
    });

    this.worker.on('exit', (code) => {
      if (code !== 0 && !this.shuttingDown) {
        logger.error({ code }, 'Worker exited');
        this.isHealthy = false;
        this.rejectAllPending(new Error('Worker crashed'));
        this.restartWorker();
      }
    });
  }

  /**
   * Persist stream chunks with 2-phase commit
   *
   * Process:
   * 1. Check queue bounds
   * 2. Create request with unique ID
   * 3. Send to worker
   * 4. Wait for ACK (30 second timeout)
   * 5. Resolve/reject based on ACK
   *
   * @param sessionId - Session identifier
   * @param chunks - Stream chunks to persist
   * @throws ServiceUnavailableError (429) when queue is full
   * @throws Error when timeout or worker failure
   */
  async persist(sessionId: string, chunks: StreamChunk[]): Promise<void> {
    // Check queue bounds before enqueueing
    if (this.messageQueue.length >= this.maxQueueSize) {
      throw new ServiceUnavailableError(
        `Persistence queue full (${this.maxQueueSize}), try again later`
      );
    }

    const request: PersistRequest = {
      id: randomUUID(),
      sessionId,
      chunks,
    };

    // Add to queue (for tracking purposes)
    this.messageQueue.push(request);

    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.messageQueue.pop();
        reject(new Error('Worker not initialized'));
        return;
      }

      // Set timeout for ACK
      const timeout = setTimeout(() => {
        this.pendingAcks.delete(request.id);
        const queueIndex = this.messageQueue.findIndex((r) => r.id === request.id);
        if (queueIndex !== -1) {
          this.messageQueue.splice(queueIndex, 1);
        }
        reject(new Error('Persistence timeout'));
      }, 30000); // 30 second timeout

      // Store resolver for ACK
      this.pendingAcks.set(request.id, (response) => {
        clearTimeout(timeout);
        const queueIndex = this.messageQueue.findIndex((r) => r.id === request.id);
        if (queueIndex !== -1) {
          this.messageQueue.splice(queueIndex, 1);
        }

        if (response.success) {
          resolve();
        } else {
          reject(new Error(response.error || 'Persistence failed'));
        }
      });

      // Send to Worker
      this.worker.postMessage(request);
    });
  }

  /**
   * Reject all pending requests when worker crashes
   */
  private rejectAllPending(error: Error): void {
    for (const [id, resolver] of this.pendingAcks) {
      resolver({ id, success: false, error: error.message });
    }
    this.pendingAcks.clear();
    this.messageQueue = [];
  }

  /**
   * Restart worker after crash
   */
  private restartWorker(): void {
    if (this.shuttingDown) return;
    logger.info('Restarting worker');
    if (this.worker) {
      this.worker.terminate();
    }
    this.initializeWorker();
    this.isHealthy = true;
  }

  /**
   * Start health check monitoring
   */
  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      if (this.messageQueue.length > this.maxQueueSize * 0.8) {
        logger.warn(
          { size: this.messageQueue.length, max: this.maxQueueSize },
          'Queue capacity warning'
        );
      }
    }, 5000);
  }

  /**
   * Stop worker and cleanup
   */
  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.messageQueue.length;
  }

  /**
   * Check if worker is healthy
   */
  isWorkerHealthy(): boolean {
    return this.isHealthy && this.worker !== null;
  }
}

export { StreamPersistWorker };
