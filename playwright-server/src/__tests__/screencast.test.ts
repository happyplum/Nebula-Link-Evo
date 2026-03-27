import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreencastManager } from '../screencast.js';

describe('ScreencastManager', () => {
  let manager: ScreencastManager;
  let mockPage: any;
  let mockCdpClient: any;

  beforeEach(() => {
    // Reset singleton instance for testing
    (ScreencastManager as any).instance = undefined;
    manager = ScreencastManager.getInstance();

    mockCdpClient = {
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn()
    };

    mockPage = {
      context: vi.fn().mockReturnValue({
        newCDPSession: vi.fn().mockResolvedValue(mockCdpClient)
      }),
      on: vi.fn()
    };

    vi.clearAllMocks();
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
      expect(mockCdpClient.on).toHaveBeenCalledWith('detached', expect.any(Function));
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
      expect(mockCdpClient.removeAllListeners).toHaveBeenCalled();
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
      
      const listener = { write: vi.fn(), end: vi.fn(), writable: true };
      manager.addListener(listener);
      
      // Get the frame handler
      const frameHandler = mockCdpClient.on.mock.calls.find((call: any) => call[0] === 'Page.screencastFrame')[1];
      
      // Call it with mock data
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });
      
      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: '123' });
      expect(listener.write).toHaveBeenCalled();
    });

    it('should drop frames if too frequent', async () => {
      await manager.start(mockPage);
      
      const listener = { write: vi.fn(), end: vi.fn(), writable: true };
      manager.addListener(listener);
      
      const frameHandler = mockCdpClient.on.mock.calls.find((call: any) => call[0] === 'Page.screencastFrame')[1];
      
      // First frame
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });
      expect(listener.write).toHaveBeenCalledTimes(1);
      
      // Second frame immediately (should be dropped)
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '124' });
      expect(listener.write).toHaveBeenCalledTimes(1);
      expect(mockCdpClient.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: '124' });
    });

    it('should remove listener if write fails', async () => {
      await manager.start(mockPage);
      
      const listener = { 
        write: vi.fn().mockImplementation(() => { throw new Error('Write failed'); }), 
        end: vi.fn(), 
        writable: true 
      };
      manager.addListener(listener);
      
      const frameHandler = mockCdpClient.on.mock.calls.find((call: any) => call[0] === 'Page.screencastFrame')[1];
      
      await frameHandler({ data: 'YmFzZTY0ZGF0YQ==', sessionId: '123' });
      
      expect(manager.getListenerCount()).toBe(0);
    });
  });

  describe('cleanup', () => {
    it('should end all listeners on cleanup', async () => {
      await manager.start(mockPage);
      
      const listener = { write: vi.fn(), end: vi.fn() };
      manager.addListener(listener);
      
      // Trigger cleanup via detached event
      const detachedHandler = mockCdpClient.on.mock.calls.find((call: any) => call[0] === 'detached')[1];
      detachedHandler();
      
      expect(listener.end).toHaveBeenCalled();
      expect(manager.getListenerCount()).toBe(0);
      expect(manager.isActive()).toBe(false);
    });

    it('should handle listener end failure during cleanup', async () => {
      await manager.start(mockPage);
      
      const listener = { 
        write: vi.fn(), 
        end: vi.fn().mockImplementation(() => { throw new Error('End failed'); }) 
      };
      manager.addListener(listener);
      
      // Trigger cleanup via page close event
      const closeHandler = mockPage.on.mock.calls.find((call: any) => call[0] === 'close')[1];
      closeHandler();
      
      expect(manager.getListenerCount()).toBe(0);
      expect(manager.isActive()).toBe(false);
    });
  });
});
