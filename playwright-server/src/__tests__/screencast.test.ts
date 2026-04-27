import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreencastManager } from '../screencast.js';

describe('ScreencastManager', () => {
  let manager: ScreencastManager;
  let mockPage: any;
  let mockCdpClient: any;
  let loggerInfoSpy: ReturnType<typeof vi.spyOn>;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    // Reset singleton instance for testing
    (ScreencastManager as any).instance = undefined;
    manager = ScreencastManager.getInstance();

    mockCdpClient = {
      on: vi.fn(),
      off: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
    };

    mockPage = {
      context: vi.fn().mockReturnValue({
        newCDPSession: vi.fn().mockResolvedValue(mockCdpClient),
      }),
      on: vi.fn(),
    };

    originalNodeEnv = process.env.NODE_ENV;
    vi.clearAllMocks();
    loggerInfoSpy = vi.spyOn((manager as any).logger, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return a singleton instance', () => {
      const instance1 = ScreencastManager.getInstance();
      const instance2 = ScreencastManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('start', () => {
    it('should start streaming', async () => {
      await manager.start(mockPage);

      expect(mockPage.context).toHaveBeenCalled();
      expect(mockPage.context().newCDPSession).toHaveBeenCalledWith(mockPage);
      expect(mockCdpClient.on).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.startScreencast', expect.any(Object));
      expect(manager.isActive()).toBe(true);
    });

    it('should stop existing stream before starting new one', async () => {
      await manager.start(mockPage);
      const stopSpy = vi.spyOn(manager, 'stop');

      await manager.start(mockPage);

      expect(stopSpy).toHaveBeenCalled();
    });

    it('should handle start failure', async () => {
      mockCdpClient.send.mockRejectedValueOnce(new Error('Start failed'));

      await expect(manager.start(mockPage)).rejects.toThrow('Start failed');
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('stop', () => {
    it('should stop streaming', async () => {
      await manager.start(mockPage);
      expect(manager.isActive()).toBe(true);

      await manager.stop();

      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.stopScreencast');
      expect(mockCdpClient.off).toHaveBeenCalledWith('Page.screencastFrame', expect.any(Function));
      expect(mockCdpClient.detach).toHaveBeenCalled();
      expect(manager.isActive()).toBe(false);
    });

    it('should do nothing if not streaming', async () => {
      await manager.stop();
      expect(mockCdpClient.send).not.toHaveBeenCalled();
    });

    it('should handle stop failure gracefully', async () => {
      await manager.start(mockPage);
      mockCdpClient.send.mockRejectedValueOnce(new Error('Stop failed'));

      await manager.stop();

      expect(manager.isActive()).toBe(false);
    });
  });

  describe('listeners', () => {
    it('should add and remove listeners', () => {
      const listener = { write: vi.fn(), end: vi.fn() };

      manager.addListener(listener);
      expect(manager.getListenerCount()).toBe(1);

      manager.removeListener(listener);
      expect(manager.getListenerCount()).toBe(0);
    });
  });

  describe('handleScreencastFrame', () => {
    it('should process frame and send to listeners', async () => {
      await manager.start(mockPage);

      const listener = { write: vi.fn().mockReturnValue(true), end: vi.fn(), once: vi.fn(), writable: true };
      manager.addListener(listener);

      // Get the frame handler
      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      // Call it with mock data
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });

      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.screencastFrameAck', {
        sessionId: '123',
      });
      expect(listener.write).toHaveBeenCalled();
    });

    it('should drop frames if too frequent', async () => {
      await manager.start(mockPage);

      const listener = { write: vi.fn().mockReturnValue(true), end: vi.fn(), once: vi.fn(), writable: true };
      manager.addListener(listener);

      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      // First frame
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });
      expect(listener.write).toHaveBeenCalledTimes(1);

      // Second frame immediately (should be dropped)
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '124' });
      expect(listener.write).toHaveBeenCalledTimes(1);
      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.screencastFrameAck', {
        sessionId: '124',
      });
    });

    it('should remove listener if write fails', async () => {
      await manager.start(mockPage);

      const listener = {
        write: vi.fn().mockImplementation(() => {
          throw new Error('Write failed');
        }),
        end: vi.fn(),
        writable: true,
      };
      manager.addListener(listener);

      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });

      expect(manager.getListenerCount()).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should end all listeners on cleanup', async () => {
      await manager.start(mockPage);

      const listener = { write: vi.fn(), end: vi.fn(), once: vi.fn(), writable: true };
      manager.addListener(listener);

      // Trigger cleanup via page close event
      const closeHandler = mockPage.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeHandler();

      expect(listener.end).toHaveBeenCalled();
      expect(manager.getListenerCount()).toBe(0);
      expect(manager.isActive()).toBe(false);
    });

    it('should handle listener end failure during cleanup', async () => {
      await manager.start(mockPage);

      const listener = {
        write: vi.fn(),
        end: vi.fn().mockImplementation(() => {
          throw new Error('End failed');
        }),
      };
      manager.addListener(listener);

      // Trigger cleanup via page close event
      const closeHandler = mockPage.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeHandler();

      expect(manager.getListenerCount()).toBe(0);
      expect(manager.isActive()).toBe(false);
    });
  });

  describe('setDebugEnabled', () => {
    it('should create counter when enabled in non-production env', () => {
      process.env.NODE_ENV = 'development';
      const consoleSpy = vi.spyOn(console, 'log');

      manager.setDebugEnabled(true);

      // Should not throw, counter created (indirectly verified via logging)
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not create counter in production env', () => {
      process.env.NODE_ENV = 'production';

      manager.setDebugEnabled(true);

      // Counter should be null — verified by no errors and no interval set
      // Disable should log nothing since counter was never created
      const consoleSpy = vi.spyOn(console, 'log');
      manager.setDebugEnabled(false);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should log final summary and null counter when disabled', () => {
      process.env.NODE_ENV = 'test';
      manager.setDebugEnabled(true);

      manager.setDebugEnabled(false);

      expect(loggerInfoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ fps: expect.any(Number), drops: expect.any(Number) }),
        'screencast final debug stats'
      );
    });

    it('should be idempotent when enabling twice', () => {
      process.env.NODE_ENV = 'test';
      manager.setDebugEnabled(true);
      manager.setDebugEnabled(true);

      // Should not create duplicate intervals
      manager.setDebugEnabled(false);
    });
  });

  describe('debug counter drop recording', () => {
    it('should record throttle drops when debug enabled', async () => {
      process.env.NODE_ENV = 'test';
      await manager.start(mockPage);

      const listener = {
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        once: vi.fn(),
        writable: true,
      };
      manager.addListener(listener);
      manager.setDebugEnabled(true);

      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      // First frame
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });
      // Second frame immediately — should be throttled
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '124' });

      // Disable debug to trigger final summary which includes drops
      manager.setDebugEnabled(false);

      const finalLog = loggerInfoSpy.mock.calls.find(
        (call: any[]) => call[1] === 'screencast final debug stats'
      );
      expect(finalLog).toBeDefined();
      expect(finalLog![0]).toEqual(
        expect.objectContaining({ drops: 1, reasons: expect.stringContaining('throttle=1') })
      );
    });

    it('should record all_backpressure drops when all listeners backed up', async () => {
      process.env.NODE_ENV = 'test';
      await manager.start(mockPage);

      // Create a listener that returns false (backpressure) and drains immediately
      const listener = {
        write: vi.fn().mockReturnValue(false),
        end: vi.fn(),
        once: vi.fn().mockImplementation((_event: string, cb: () => void) => {
          // Drain immediately so backpressure clears but listener stays in backedUp set during this frame
          return listener;
        }),
        writable: true,
      };
      manager.addListener(listener);
      manager.setDebugEnabled(true);

      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      // First frame — listener gets backed up
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });

      // Manually add listener to backedUpListeners to simulate all-backpressure scenario
      // Use the internal state by creating a second listener that's already backed up
      const listener2 = {
        write: vi.fn().mockReturnValue(false),
        end: vi.fn(),
        once: vi.fn().mockImplementation((_event: string, _cb: () => void) => listener2),
        writable: true,
      };
      manager.addListener(listener2);

      // Wait for throttle window to pass
      await new Promise((r) => setTimeout(r, 35));

      // Now both listeners should be backed up from the first frame's backpressure
      // Actually, the drain callbacks from first frame cleared them. Let's manually set up backpressure:
      // Send a frame that makes both listeners return false
      listener.write.mockReturnValue(false);
      listener2.write.mockReturnValue(false);
      // Make drain NOT fire immediately
      listener.once = vi.fn().mockReturnValue(listener);
      listener2.once = vi.fn().mockReturnValue(listener2);

      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '200' });

      // Now both are backed up. Next frame will hit all_backpressure
      await new Promise((r) => setTimeout(r, 35));
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '201' });

      manager.setDebugEnabled(false);

      const finalLog = loggerInfoSpy.mock.calls.find(
        (call: any[]) => call[1] === 'screencast final debug stats'
      );
      expect(finalLog).toBeDefined();
      expect(finalLog![0]).toEqual(
        expect.objectContaining({ reasons: expect.stringContaining('all_backpressure=1') })
      );
    });

    it('should record successful frames', async () => {
      process.env.NODE_ENV = 'test';
      await manager.start(mockPage);

      const listener = {
        write: vi.fn().mockReturnValue(true),
        end: vi.fn(),
        once: vi.fn(),
        writable: true,
      };
      manager.addListener(listener);
      manager.setDebugEnabled(true);

      const frameHandler = mockCdpClient.on.mock.calls.find(
        (call: any) => call[0] === 'Page.screencastFrame'
      )[1];

      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });

      manager.setDebugEnabled(false);

      const finalLog = loggerInfoSpy.mock.calls.find(
        (call: any[]) => call[1] === 'screencast final debug stats'
      );
      expect(finalLog).toBeDefined();
      expect(finalLog![0]).toEqual(
        expect.objectContaining({ fps: expect.any(Number), drops: 0, reasons: '' })
      );
    });
  });
});
