import { StreamPersistWorker } from '../stream-persist-worker.js';
import { StreamBufferPersistenceManager } from '../stream-buffer-persistence.js';
let persistWorker: StreamPersistWorker | null = null;
let persistenceManager: StreamBufferPersistenceManager | null = null;
let isInitialized = false;
export function getPersistWorker(): StreamPersistWorker {
  if (!persistWorker) persistWorker = new StreamPersistWorker();
  return persistWorker;
}
export function getPersistenceManager(): StreamBufferPersistenceManager {
  if (!persistenceManager) {
    persistenceManager = new StreamBufferPersistenceManager({ autoCleanup: true, cleanupInterval: 24 });
  }
  return persistenceManager;
}
export function initializePersistence(): void {
  if (isInitialized) return;
  getPersistWorker();
  getPersistenceManager();
  isInitialized = true;
}

export function cleanupPersistence(): void {
  persistWorker?.shutdown();
  persistenceManager?.close();
  persistWorker = null;
  persistenceManager = null;
  isInitialized = false;
}

export function shutdownPersistence(): void {
  cleanupPersistence();
}
