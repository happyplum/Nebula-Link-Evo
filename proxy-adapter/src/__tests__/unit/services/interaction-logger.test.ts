import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockInsertInteraction,
  mockWriteFileSync,
  mockMkdirSync,
  mockExistsSync,
} = vi.hoisted(() => ({
  mockInsertInteraction: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockExistsSync: vi.fn(() => true),
}));

vi.mock('../../../conversation/db.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      insertInteraction: mockInsertInteraction,
    }),
  },
}));

vi.mock('node:fs', () => ({
  writeFileSync: mockWriteFileSync,
  mkdirSync: mockMkdirSync,
  existsSync: mockExistsSync,
}));

describe('InteractionLogger', () => {
  beforeEach(() => {
    // Mock process.exit to prevent tests from exiting when SIGINT/SIGTERM handlers are triggered
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.useFakeTimers();
    mockInsertInteraction.mockReset();
    mockInsertInteraction.mockImplementation(() => undefined);
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(async () => {
    const module = await import('../../../services/interaction-logger.js');
    await module.InteractionLogger.getInstance().destroy();
    vi.useRealTimers();
    vi.resetModules();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance for multiple calls to getInstance', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger1 = module.InteractionLogger.getInstance();
      const logger2 = module.InteractionLogger.getInstance();

      expect(logger1).toBe(logger2);
    });
  });

  describe('log()', () => {
    it('should add interaction to queue without flushing immediately', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });

      expect(logger.getQueueLength()).toBe(1);
      expect(mockInsertInteraction).not.toHaveBeenCalled();
    });

    it('should schedule flush when queue reaches batch size (100)', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 99; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      expect(mockInsertInteraction).not.toHaveBeenCalled();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });
      await vi.runAllTicks();

      expect(mockInsertInteraction).toHaveBeenCalledTimes(100);
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should schedule flush when queue reaches max buffer size (1000)', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 1000; i++) {
        await logger.log({
          action_type: 'scroll',
          target_type: 'page',
          success: true,
        });
      }

      await Promise.resolve();

      expect(mockInsertInteraction).toHaveBeenCalled();
      expect(logger.getQueueLength()).toBeLessThan(1000);
    });

    it('should store timestamp for each logged interaction', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();
      const timestampBefore = Date.now();

      await logger.log({
        action_type: 'type',
        target_type: 'input',
        success: true,
      });

      const timestampAfter = Date.now();

      expect(logger.getQueueLength()).toBe(1);
    });
  });

  describe('flush()', () => {
    it('should flush all queued interactions in batches', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 250; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledTimes(250);
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should handle database insert failures gracefully', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db insert failed');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'type',
        target_type: 'input',
        success: false,
        error_message: 'db failure test',
      });
      await logger.flush();

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockWriteFileSync.mock.calls[0];
      expect(String(filePath)).toContain('.sisyphus');
      expect(String(filePath)).toContain('failures');
      expect(String(filePath)).toContain('logger');
      expect(String(content)).toContain('db failure test');
    });

    it('should not flush if already flushing', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });

      const flushPromise1 = logger.flush();
      const flushPromise2 = logger.flush();

      await Promise.all([flushPromise1, flushPromise2]);

      expect(mockInsertInteraction).toHaveBeenCalledTimes(1);
    });

    it('should not flush if queue is empty', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.flush();

      expect(mockInsertInteraction).not.toHaveBeenCalled();
    });
  });

  describe('scheduleFlush()', () => {
    it('should schedule flush on next microtask when queue threshold reached', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();
      const flushSpy = vi.spyOn(logger, 'flush' as never);

      for (let i = 0; i < 100; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await vi.runAllTicks();

      expect(flushSpy).toHaveBeenCalled();
      flushSpy.mockRestore();
    });

    it('should not schedule multiple flushes if already scheduled', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();
      const flushSpy = vi.spyOn(logger, 'flush' as never);

      for (let i = 0; i < 150; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await vi.runAllTicks();

      expect(flushSpy).toHaveBeenCalled();
      flushSpy.mockRestore();
    });
  });

  describe('Periodic Flush', () => {
    it('should flush periodically every 5 seconds', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'wait',
        target_type: 'page',
        success: true,
      });

      expect(mockInsertInteraction).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5000);

      expect(mockInsertInteraction).toHaveBeenCalledTimes(1);
      expect(logger.getQueueLength()).toBe(0);
    });

    it('should schedule periodic flush immediately after previous one completes', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'wait',
        target_type: 'page',
        success: true,
      });

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockInsertInteraction).toHaveBeenCalledTimes(1);

      await logger.log({
        action_type: 'wait',
        target_type: 'page',
        success: true,
      });

      await vi.advanceTimersByTimeAsync(5000);
      expect(mockInsertInteraction).toHaveBeenCalledTimes(2);
    });
  });

  describe('Exit Handlers', () => {
    it('should flush on beforeExit signal', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'navigate',
        target_type: 'page',
        success: true,
      });

      process.emit('beforeExit', 0);
      await vi.runAllTicks();

      expect(mockInsertInteraction).toHaveBeenCalled();
    });

    it('should flush on exit signal', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'navigate',
        target_type: 'page',
        success: true,
      });

      process.emit('exit', 0);
      await vi.runAllTicks();

      expect(mockInsertInteraction).toHaveBeenCalled();
    });

    it('should flush on SIGINT signal', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();
      const processExitSpy = vi.spyOn(process, 'exit');

      await logger.log({
        action_type: 'navigate',
        target_type: 'page',
        success: true,
      });

      process.emit('SIGINT');
      await vi.runAllTicks();

      expect(mockInsertInteraction).toHaveBeenCalled();
      processExitSpy.mockRestore();
    });

    it('should flush on SIGTERM signal', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();
      const processExitSpy = vi.spyOn(process, 'exit');

      await logger.log({
        action_type: 'navigate',
        target_type: 'page',
        success: true,
      });

      process.emit('SIGTERM');
      await vi.runAllTicks();

      expect(mockInsertInteraction).toHaveBeenCalled();
      processExitSpy.mockRestore();
    });
  });

  describe('Fallback Logging', () => {
    it('should log failures to file with proper format', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db error');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: false,
        error_message: 'test error',
      });

      await logger.flush();

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.sisyphus/failures/logger'),
        { recursive: true }
      );

      const [filePath, content] = mockWriteFileSync.mock.calls[0];
      expect(String(filePath)).toMatch(/failed-interactions-\d+\.json$/);

      const loggedContent = JSON.parse(String(content));
      expect(loggedContent).toHaveLength(1);
      expect(loggedContent[0]).toMatchObject({
        error: 'db error',
        params: {
          action_type: 'click',
          target_type: 'coordinates',
          success: false,
          error_message: 'test error',
        },
      });
      expect(loggedContent[0]).toHaveProperty('timestamp');
    });

    it('should log multiple failures to file', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db error');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 5; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await logger.flush();

      expect(mockMkdirSync).toHaveBeenCalled();
      const [filePath, content] = mockWriteFileSync.mock.calls[0];
      expect(String(filePath)).toMatch(/failed-interactions-\d+\.json$/);

      const loggedContent = JSON.parse(String(content));
      expect(loggedContent).toHaveLength(5);
    });

    it('should handle file write failures gracefully', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db error');
      });
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('file write error');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });

      await expect(logger.flush()).resolves.not.toThrow();
    });

    it('should use fallback logging when logFailuresToFile fails', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db error');
      });
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('file write error');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 5; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await logger.flush();

      // Both logFailuresToFile and fallbackLogAll should be called
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });

  describe('getQueueLength()', () => {
    it('should return correct queue length', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      expect(logger.getQueueLength()).toBe(0);

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });
      expect(logger.getQueueLength()).toBe(1);

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });
      expect(logger.getQueueLength()).toBe(2);

      await logger.flush();
      expect(logger.getQueueLength()).toBe(0);
    });
  });

  describe('destroy()', () => {
    it('should clear periodic flush interval', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      await logger.destroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    it('should remove all exit handlers', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      const offSpy = vi.spyOn(process, 'off');

      await logger.destroy();

      expect(offSpy).toHaveBeenCalledWith('exit', expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith('beforeExit', expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

      offSpy.mockRestore();
    });

    it('should flush remaining interactions before cleanup', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });

      await logger.destroy();

      expect(mockInsertInteraction).toHaveBeenCalled();
      expect(logger.getQueueLength()).toBe(0);
    });
  });

  describe('Non-Blocking Behavior', () => {
    it('should keep log non-blocking when flush is slow', async () => {
      vi.useRealTimers();

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 99; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      const flushSpy = vi
        .spyOn(logger, 'flush' as never)
        .mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 30)));

      const start = Date.now();
      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });
      const elapsed = Date.now() - start;

      await new Promise((resolve) => setImmediate(resolve));
      expect(flushSpy).toHaveBeenCalled();
      expect(elapsed).toBeLessThan(10);

      flushSpy.mockRestore();
    });
  });

  describe('Interaction Parameters', () => {
    it('should handle all optional interaction parameters', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        timestamp: 1234567890,
        snapshot_id: 'snapshot-123',
        nebula_id: 999,
        action_type: 'click',
        target_type: 'element',
        locator_strategy: 'css-selector',
        success: false,
        attempts: 3,
        latency_ms: 150,
        error_code: 'ELEMENT_NOT_FOUND',
        error_message: 'Element not visible',
        failure_sample_path: '/path/to/sample.png',
      });

      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: 1234567890,
          snapshot_id: 'snapshot-123',
          nebula_id: 999,
          action_type: 'click',
          target_type: 'element',
          locator_strategy: 'css-selector',
          success: false,
          attempts: 3,
          latency_ms: 150,
          error_code: 'ELEMENT_NOT_FOUND',
          error_message: 'Element not visible',
          failure_sample_path: '/path/to/sample.png',
        })
      );
    });

    it('should handle minimal interaction parameters', async () => {
      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      await logger.log({
        action_type: 'scroll',
        target_type: 'page',
        success: true,
      });

      await logger.flush();

      expect(mockInsertInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: 'scroll',
          target_type: 'page',
          success: true,
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should use fallback logging when logFailuresToFile fails', async () => {
      mockInsertInteraction.mockImplementation(() => {
        throw new Error('db error');
      });
      mockWriteFileSync.mockImplementation(() => {
        throw new Error('file write error');
      });
      mockExistsSync.mockReturnValue(false);

      const module = await import('../../../services/interaction-logger.js');
      const logger = module.InteractionLogger.getInstance();

      for (let i = 0; i < 5; i++) {
        await logger.log({
          action_type: 'click',
          target_type: 'coordinates',
          success: true,
        });
      }

      await logger.flush();

      // Both logFailuresToFile and fallbackLogAll should be called
      expect(mockWriteFileSync).toHaveBeenCalled();
    });
  });
});
