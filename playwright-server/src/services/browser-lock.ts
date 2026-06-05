import { Mutex } from 'async-mutex';
import { createWorkerLogger } from './logger.js';

const logger = createWorkerLogger('BrowserLock');

export class BrowserMutexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserMutexError';
  }
}

export const browserMutex = new Mutex();

export async function acquireLock(
  owner: string = 'BrowserService',
  timeoutMs: number = 30000
): Promise<() => void> {
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const acquirePromise = browserMutex.acquire();
  acquirePromise.then((release) => {
    if (timedOut) {
      release();
    }
  }).catch(() => {
    // acquire() only rejects when the mutex is canceled; callers handle the raced promise.
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      reject(new BrowserMutexError(`${owner} timed out acquiring browser mutex after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const release = await Promise.race([acquirePromise, timeoutPromise]);
  if (timeout) {
    clearTimeout(timeout);
  }

  logger.debug({ owner }, 'Browser mutex acquired');
  return () => {
    logger.debug({ owner }, 'Browser mutex released');
    release();
  };
}
