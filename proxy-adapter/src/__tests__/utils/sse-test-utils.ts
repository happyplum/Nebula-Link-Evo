import { vi } from 'vitest';
import { ConversationManager } from '../../conversation/manager.js';
import type { SessionEvent } from '../../../shared/types/sse-events.js';

/**
 * Mock SessionEventHub for testing SSE pub/sub behavior
 *
 * @param config - Optional configuration for mock behavior
 * @returns Mock SessionEventHub instance
 */
export function createMockSessionEventHub(config?: {
  shouldFailOnPublish?: boolean;
  initialState?: Map<string, Set<ReturnType<typeof vi.fn>>>;
}): {
  subscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  getSubscriberCount: ReturnType<typeof vi.fn>;
  _subscribers: Map<string, Set<ReturnType<typeof vi.fn>>>;
  _clear: () => void;
} {
  const mockConfig = {
    shouldFailOnPublish: false,
    initialState: new Map<string, Set<ReturnType<typeof vi.fn>>>(),
    ...config,
  };

  const subscribers: Map<string, Set<ReturnType<typeof vi.fn>>> =
    mockConfig.initialState;

  const mockHub = {
    subscribe: vi.fn((sessionId: string, callback: (event: SessionEvent) => void): (() => void) => {
      if (!subscribers.has(sessionId)) {
        subscribers.set(sessionId, new Set());
      }
      subscribers.get(sessionId)!.add(callback);

      // Return unsubscribe function
      return () => {
        const sessionSubs = subscribers.get(sessionId);
        if (sessionSubs) {
          sessionSubs.delete(callback);
          if (sessionSubs.size === 0) {
            subscribers.delete(sessionId);
          }
        }
      };
    }),

    publish: vi.fn((sessionId: string, event: SessionEvent): void => {
      if (mockConfig.shouldFailOnPublish) {
        throw new Error('Failed to publish event');
      }

      const sessionSubs = subscribers.get(sessionId);
      if (sessionSubs) {
        sessionSubs.forEach(callback => {
          try {
            callback(event);
          } catch (error) {
            console.error('Subscriber callback failed:', error);
          }
        });
      }
    }),

    getSubscriberCount: vi.fn((sessionId: string): number => {
      return subscribers.get(sessionId)?.size ?? 0;
    }),

    _subscribers: subscribers,

    _clear: (): void => {
      subscribers.clear();
    },
  };

  return mockHub;
}

/**
 * Mock ConversationManager for testing session and message operations
 *
 * @param config - Optional configuration for mock behavior
 * @returns Mock ConversationManager instance
 */
export function createMockConversationManager(config?: {
  dbPath?: string;
  shouldFailOnCreate?: boolean;
  shouldFailOnGet?: boolean;
  initialSessions?: Record<string, ReturnType<typeof vi.fn>>;
}): {
  createSession: ReturnType<typeof vi.fn>;
  getSession: ReturnType<typeof vi.fn>;
  listSessions: ReturnType<typeof vi.fn>;
  addMessage: ReturnType<typeof vi.fn>;
  deleteSession: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _dbPath: string;
} {
  const mockConfig = {
    dbPath: ':memory:',
    shouldFailOnCreate: false,
    shouldFailOnGet: false,
    initialSessions: {},
    ...config,
  };

  // Use real ConversationManager with in-memory DB for realistic behavior
  // This allows SQLite operations to work correctly in tests
  let manager: ConversationManager | null = null;

  try {
    manager = new ConversationManager(mockConfig.dbPath);
  } catch (error) {
    console.error('Failed to initialize ConversationManager:', error);
  }

  const mockManager = {
    createSession: vi.fn((params: unknown) => {
      if (mockConfig.shouldFailOnCreate) {
        throw new Error('Failed to create session');
      }
      if (manager) {
        return manager.createSession(params as Parameters<typeof manager.createSession>[0]);
      }
      return { id: 'test-session', title: 'Test Session' };
    }),

    getSession: vi.fn((id: string) => {
      if (mockConfig.shouldFailOnGet) {
        throw new Error('Failed to get session');
      }
      if (manager) {
        return manager.getSession(id);
      }
      return mockConfig.initialSessions[id] ?? null;
    }),

    listSessions: vi.fn(() => {
      if (manager) {
        return manager.listSessions();
      }
      return [];
    }),

    addMessage: vi.fn((sessionId: string, message: unknown) => {
      if (manager) {
        return manager.addMessage(sessionId, message as Parameters<typeof manager.addMessage>[1]);
      }
      return { id: 'msg-test', role: 'user', content: 'test' };
    }),

    deleteSession: vi.fn((id: string) => {
      if (manager) {
        manager.deleteSession(id);
      }
    }),

    close: vi.fn(() => {
      if (manager) {
        manager.close();
        manager = null;
      }
    }),

    _dbPath: mockConfig.dbPath,
  };

  return mockManager;
}

/**
 * Mock SessionLock for testing concurrency control
 *
 * @param config - Optional configuration for mock behavior
 * @returns Mock SessionLock instance
 */
export function createMockSessionLock(config?: {
  ttlMs?: number;
  shouldFailOnAcquire?: boolean;
  initialState?: Map<string, string>;
}): {
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  isLocked: ReturnType<typeof vi.fn>;
  getActiveRun: ReturnType<typeof vi.fn>;
  _clear: () => void;
  _activeRuns: Map<string, string>;
} {
  const mockConfig = {
    ttlMs: 30000,
    shouldFailOnAcquire: false,
    initialState: new Map<string, string>(),
    ...config,
  };

  const activeRuns: Map<string, string> = mockConfig.initialState;
  const ttlTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const mockLock = {
    acquire: vi.fn((sessionId: string, runId: string): boolean => {
      if (mockConfig.shouldFailOnAcquire) {
        throw new Error('Failed to acquire lock');
      }

      if (activeRuns.has(sessionId)) {
        return false; // Already locked
      }

      activeRuns.set(sessionId, runId);

      // Set TTL auto-release
      const timer = setTimeout(() => {
        activeRuns.delete(sessionId);
        ttlTimers.delete(sessionId);
      }, mockConfig.ttlMs);
      ttlTimers.set(sessionId, timer);

      return true;
    }),

    release: vi.fn((sessionId: string, runId: string): void => {
      const activeRun = activeRuns.get(sessionId);
      if (activeRun === runId) {
        activeRuns.delete(sessionId);
        const timer = ttlTimers.get(sessionId);
        if (timer) {
          clearTimeout(timer);
          ttlTimers.delete(sessionId);
        }
      }
    }),

    isLocked: vi.fn((sessionId: string): boolean => {
      return activeRuns.has(sessionId);
    }),

    getActiveRun: vi.fn((sessionId: string): string | undefined => {
      return activeRuns.get(sessionId);
    }),

    _clear: (): void => {
      activeRuns.clear();
      ttlTimers.forEach(timer => clearTimeout(timer));
      ttlTimers.clear();
    },

    _activeRuns: activeRuns,
  };

  return mockLock;
}

/**
 * Cleanup function to reset all mock state
 * Use in afterEach() hooks for test isolation
 */
export function cleanupMockMocks(): void {
  // Clear all vi.fn mocks globally
  vi.clearAllMocks();
}
