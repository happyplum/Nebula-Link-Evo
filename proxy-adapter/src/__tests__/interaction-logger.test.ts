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

vi.mock('../conversation/db.js', () => ({
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
    vi.useFakeTimers();
    mockInsertInteraction.mockReset();
    mockInsertInteraction.mockImplementation(() => undefined);
    mockWriteFileSync.mockReset();
    mockMkdirSync.mockReset();
    mockExistsSync.mockReset();
    mockExistsSync.mockReturnValue(true);
  });

  afterEach(async () => {
    const module = await import('../services/interaction-logger.js');
    await module.InteractionLogger.getInstance().destroy();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('should flush when queue reaches batch size 100', async () => {
    const module = await import('../services/interaction-logger.js');
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

  it('should flush periodically every 5 seconds', async () => {
    const module = await import('../services/interaction-logger.js');
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

  it('should force flush when queue reaches max buffer 1000', async () => {
    const module = await import('../services/interaction-logger.js');
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

  it('should fallback to file logging when database insert fails', async () => {
    mockInsertInteraction.mockImplementation(() => {
      throw new Error('db insert failed');
    });
    mockExistsSync.mockReturnValue(false);

    const module = await import('../services/interaction-logger.js');
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
    expect(String(content)).toContain('db insert failed');
  });

  it('should flush on beforeExit signal', async () => {
    const module = await import('../services/interaction-logger.js');
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

  it('should keep log non-blocking when flush is slow', async () => {
    vi.useRealTimers();

    const module = await import('../services/interaction-logger.js');
    const logger = module.InteractionLogger.getInstance();

    for (let i = 0; i < 99; i++) {
      await logger.log({
        action_type: 'click',
        target_type: 'coordinates',
        success: true,
      });
    }

    const flushSpy = vi
      .spyOn(logger, 'flush')
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
  });
});
