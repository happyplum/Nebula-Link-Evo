import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MockPersistWorker {
  shutdown: ReturnType<typeof vi.fn>;
}

interface MockPersistenceManager {
  close: ReturnType<typeof vi.fn>;
}

const persistenceMocks = vi.hoisted(() => {
  const workerInstances: MockPersistWorker[] = [];
  const managerInstances: MockPersistenceManager[] = [];

  const StreamPersistWorker = vi.fn(
    class {
      shutdown = vi.fn();

      constructor() {
        workerInstances.push(this as MockPersistWorker);
      }
    }
  );

  const StreamBufferPersistenceManager = vi.fn(
    class {
      close = vi.fn();

      constructor() {
        managerInstances.push(this as MockPersistenceManager);
      }
    }
  );

  return {
    StreamPersistWorker,
    StreamBufferPersistenceManager,
    workerInstances,
    managerInstances,
    reset: () => {
      StreamPersistWorker.mockClear();
      StreamBufferPersistenceManager.mockClear();
      workerInstances.length = 0;
      managerInstances.length = 0;
    },
  };
});

vi.mock('../../stream-persist-worker.js', () => {
  return {
    StreamPersistWorker: persistenceMocks.StreamPersistWorker,
  };
});

vi.mock('../../stream-buffer-persistence.js', () => {
  return {
    StreamBufferPersistenceManager: persistenceMocks.StreamBufferPersistenceManager,
  };
});

import {
  cleanupPersistence,
  getPersistWorker,
  getPersistenceManager,
  initializePersistence,
  shutdownPersistence,
} from '../persistence-singletons.js';

describe('persistence-singletons', () => {
  beforeEach(() => {
    cleanupPersistence();
    persistenceMocks.reset();
  });

  it('getPersistWorker returns same instance', () => {
    const firstInstance = getPersistWorker();
    const secondInstance = getPersistWorker();

    expect(firstInstance).toBe(secondInstance);
    expect(persistenceMocks.StreamPersistWorker).toHaveBeenCalledTimes(1);
  });

  it('getPersistenceManager returns same instance', () => {
    const firstInstance = getPersistenceManager();
    const secondInstance = getPersistenceManager();

    expect(firstInstance).toBe(secondInstance);
    expect(persistenceMocks.StreamBufferPersistenceManager).toHaveBeenCalledTimes(1);
  });

  it('cleanupPersistence destroys singletons by clearing them to null', () => {
    initializePersistence();
    initializePersistence();

    expect(persistenceMocks.StreamPersistWorker).toHaveBeenCalledTimes(1);
    expect(persistenceMocks.StreamBufferPersistenceManager).toHaveBeenCalledTimes(1);

    const firstWorker = persistenceMocks.workerInstances[0];
    const firstManager = persistenceMocks.managerInstances[0];

    cleanupPersistence();

    expect(firstWorker.shutdown).toHaveBeenCalledTimes(1);
    expect(firstManager.close).toHaveBeenCalledTimes(1);

    cleanupPersistence();

    expect(firstWorker.shutdown).toHaveBeenCalledTimes(1);
    expect(firstManager.close).toHaveBeenCalledTimes(1);
  });

  it('can re-initialize after cleanup', () => {
    initializePersistence();

    const firstWorker = persistenceMocks.workerInstances[0];
    const firstManager = persistenceMocks.managerInstances[0];

    shutdownPersistence();

    const secondWorker = getPersistWorker();
    const secondManager = getPersistenceManager();

    expect(secondWorker).not.toBe(firstWorker);
    expect(secondManager).not.toBe(firstManager);
    expect(persistenceMocks.StreamPersistWorker).toHaveBeenCalledTimes(2);
    expect(persistenceMocks.StreamBufferPersistenceManager).toHaveBeenCalledTimes(2);
  });
});
