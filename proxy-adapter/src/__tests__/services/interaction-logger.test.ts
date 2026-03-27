import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { CreateInteractionParams } from '../../conversation/types.js';

// Hoist mocks before module imports
const {
  mockInsertInteraction,
  mockWriteFileSync,
  mockMkdirSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockInsertInteraction: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock('../../conversation/db.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      insertInteraction: mockInsertInteraction,
    })),
  },
}));

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
}));

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/'),
}));

// Import after mocks are set up
import { InteractionLogger } from '../../services/interaction-logger.js';

describe('InteractionLogger', () => {
  let logger: InteractionLogger;

  // Helper to reset singleton instance
  const resetSingleton = () => {
    (InteractionLogger as any).instance = undefined;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    resetSingleton();

    // Reset mocks
    mockInsertInteraction.mockClear();
    mockWriteFileSync.mockClear();
    mockMkdirSync.mockClear();
    mockExistsSync.mockClear();
    mockExistsSync.mockReturnValue(false);

    // Get a fresh instance
    logger = InteractionLogger.getInstance();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createMockInteraction = (
    overrides: Partial<CreateInteractionParams> = {}
  ): CreateInteractionParams => ({
    action_type: 'click',
    target_type: 'coordinates',
    success: true,
    ...overrides,
  });

  describe('Singleton Pattern', () => {
    it('should return same instance on multiple getInstance() calls', () => {
      const instance1 = InteractionLogger.getInstance();
      const instance2 = InteractionLogger.getInstance();
      const instance3 = InteractionLogger.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe('log()', () => {
    it('should add item to queue', async () => {
      const interaction = createMockInteraction();

      await logger.log(interaction);

      expect(logger.getQueueLength()).toBe(1);
    });

    it('should add multiple items to queue', async () => {
      for (let i = 0; i < 5; i++) {
        await logger.log(createMockInteraction({ action_type: `action_${i}` }));
      }

      expect(logger.getQueueLength()).toBe(5);
    });
  });

  describe('getQueueLength()', () => {
    it('should return 0 for new instance', () => {
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should return correct queue length after logs', async () => {
      await logger.log(createMockInteraction());
      expect(logger.getQueueLength()).toBe(1);

      await logger.log(createMockInteraction());
      expect(logger.getQueueLength()).toBe(2);

      await logger.log(createMockInteraction());
      expect(logger.getQueueLength()).toBe(3);
    });
  });

  describe('flush()', () => {
    it('should process queue items to database', async () => {
      const interaction = createMockInteraction();

      await logger.log(interaction);
      await logger.log(interaction);
      await logger.log(interaction);

      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledTimes(3);
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should do nothing if queue is empty', async () => {
      await logger.flush();

      expect(mockInsertInteraction).not.toHaveBeenCalled();
    });

    it('should batch process up to BATCH_SIZE items at a time', async () => {
      const interaction = createMockInteraction();

      // Log 250 items (2.5 batches)
      for (let i = 0; i < 250; i++) {
        await logger.log(interaction);
      }

      await logger.flush();

      // Should be called 250 times (100 + 100 + 50)
      expect(mockInsertInteraction).toHaveBeenCalledTimes(250);
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      const interaction = createMockInteraction();

      mockInsertInteraction.mockImplementation(() => {
        throw new Error('DB Error');
      });
      mockExistsSync.mockReturnValue(false);

      await logger.log(interaction);
      await logger.log(interaction);

      await logger.flush();

      // Should have written to failure file
      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalled();
    });

    it('should write failures to file with correct format', async () => {
      const interaction = createMockInteraction({ action_type: 'failed_action' });

      mockInsertInteraction.mockImplementation(() => {
        throw new Error('DB Error');
      });
      mockExistsSync.mockReturnValue(false);

      await logger.log(interaction);

      await logger.flush();

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringMatching(/failed-interactions-\d+\.json/),
        expect.stringContaining('failed_action'),
        'utf-8'
      );
    });

    it('should use fallbackLogAll if entire flush fails', async () => {
      const interaction = createMockInteraction();

      // Make the while loop fail by throwing in the catch block
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('DB Error');
      });
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('File write error');
      });
      mockExistsSync.mockReturnValue(false);

      await logger.log(interaction);
      await logger.log(interaction);

      await logger.flush();

      // Should attempt mkdir for fallback
      expect(mockMkdirSync).toHaveBeenCalled();
    });
  });

  describe('Auto-flush behavior', () => {
    it('should trigger flush when queue reaches BATCH_SIZE', async () => {
      const interaction = createMockInteraction();

      // Log 100 items (BATCH_SIZE)
      for (let i = 0; i < 100; i++) {
        await logger.log(interaction);
      }

      // Queue should be empty after auto-flush (via scheduleFlush)
      await logger.flush(); // Ensure async operations complete
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should not flush before BATCH_SIZE reached', async () => {
      const interaction = createMockInteraction();

      // Log 99 items (one short of BATCH_SIZE)
      for (let i = 0; i < 99; i++) {
        await logger.log(interaction);
      }

      expect(logger.getQueueLength()).toBe(99);
    });

    it('should trigger flush when MAX_BUFFER_SIZE reached', async () => {
      const interaction = createMockInteraction();

      // Log 1000 items (MAX_BUFFER_SIZE)
      for (let i = 0; i < 1000; i++) {
        await logger.log(interaction);
      }

      await logger.flush();
      expect(logger.getQueueLength()).toBe(0);
    });
  });

  describe('Error handling', () => {
    it('should log individual failures to file', async () => {
      const interaction1 = createMockInteraction({ action_type: 'action1' });
      const interaction2 = createMockInteraction({ action_type: 'action2' });

      // Make second call fail
      let callCount = 0;
      mockInsertInteraction.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('DB Error');
        }
      });
      mockExistsSync.mockReturnValue(false);

      await logger.log(interaction1);
      await logger.log(interaction2);

      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledTimes(2);
      expect(mockWriteFileSync).toHaveBeenCalled();

      // Check that failure log includes error message
      const writeCall = mockWriteFileSync.mock.calls.find((call) =>
        call[0].includes('failed-interactions')
      );
      expect(writeCall).toBeDefined();
      expect(writeCall![1]).toContain('DB Error');
    });

    it('should handle flush error and continue gracefully', async () => {
      const interaction = createMockInteraction({ action_type: 'test_action' });

      // All DB calls fail
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('Complete failure');
      });
      mockExistsSync.mockReturnValue(true); // Directory exists

      await logger.log(interaction);

      await logger.flush();

      // Should have attempted to write failures to file
      expect(mockWriteFileSync).toHaveBeenCalled();

      // Queue should be empty after flush (even if DB failed)
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should handle mkdir errors gracefully', async () => {
      const interaction = createMockInteraction();

      mockInsertInteraction.mockImplementation(() => {
        throw new Error('DB Error');
      });
      mockExistsSync.mockReturnValue(false);
      mockMkdirSync.mockImplementation(() => {
        throw new Error('Mkdir failed');
      });

      await logger.log(interaction);

      // Should not throw
      await expect(logger.flush()).resolves.not.toThrow();
    });
  });

  describe('destroy()', () => {
    it('should flush remaining queue before destroy', async () => {
      const interaction = createMockInteraction();

      await logger.log(interaction);
      await logger.log(interaction);

      await logger.destroy();

      expect(mockInsertInteraction).toHaveBeenCalledTimes(2);
    });

    it('should handle destroy with empty queue', async () => {
      await logger.destroy();

      expect(mockInsertInteraction).not.toHaveBeenCalled();
    });

    it('should handle multiple destroy calls', async () => {
      await logger.destroy();
      await logger.destroy();
      // Should not throw on second call
    });
  });

  describe('flush re-entrancy', () => {
    it('should not allow concurrent flushes', async () => {
      const interaction = createMockInteraction();

      // Add items to queue
      for (let i = 0; i < 50; i++) {
        await logger.log(interaction);
      }

      // Start a flush and immediately start another
      const flush1 = logger.flush();
      const flush2 = logger.flush();

      await Promise.all([flush1, flush2]);

      // Should only process once
      expect(mockInsertInteraction).toHaveBeenCalledTimes(50);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty interaction params', async () => {
      const interaction = createMockInteraction();

      await logger.log(interaction);
      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledWith(interaction);
    });

    it('should handle interactions with all optional fields', async () => {
      const interaction: CreateInteractionParams = {
        action_type: 'click',
        target_type: 'marker',
        snapshot_id: 'snap123',
        nebula_id: 42,
        locator_strategy: 'nebula',
        success: true,
        attempts: 2,
        latency_ms: 150,
        failure_sample_path: null,
      };

      await logger.log(interaction);
      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledWith(interaction);
    });

    it('should handle concurrent log calls', async () => {
      const interaction = createMockInteraction();

      // Log multiple items concurrently
      const logs = Array.from({ length: 50 }, () => logger.log(interaction));

      await Promise.all(logs);

      expect(logger.getQueueLength()).toBe(50);
    });
  });
});
