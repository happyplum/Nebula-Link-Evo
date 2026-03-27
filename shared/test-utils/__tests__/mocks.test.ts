import { describe, it, expect } from 'vitest';
import {
  createKimiClientMock,
  createBrowserLifecycleMock,
  createWebSocketMock,
  simulateWebSocketMessage,
} from '../index.js';
import type { DecisionContext } from '../../../proxy-adapter/src/clients/types.js';

describe('shared/test-utils mocks', () => {
  describe('KimiClient mock', () => {
    it('should create a mock KimiClient', () => {
      const mockClient = createKimiClientMock();

      expect(mockClient.provider).toBe('kimi');
      expect(mockClient.model).toBe('moonshot-v1-vision-preview');
      expect(mockClient.getCapabilities()).toEqual(['decision']);
    });

    it('should mock decide method', async () => {
      const mockClient = createKimiClientMock();
      const mockContext: DecisionContext = {
        screenshot: 'base64-screenshot',
        dom: {
          snapshot_id: 'test-snapshot',
          elements_map: {},
          simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } },
          version: '2.0',
        },
        elements: [],
        instruction: 'Test instruction',
        previousActions: [],
      };

      const action = await mockClient.decide(mockContext);

      expect(action.type).toBe('finish');
      expect(mockClient.decide).toHaveBeenCalled();
    });

    it('should handle failure mode', async () => {
      const mockClient = createKimiClientMock({ shouldFail: true });
      const mockContext: DecisionContext = {
        screenshot: 'base64-screenshot',
        dom: {
          snapshot_id: 'test-snapshot',
          elements_map: {},
          simplified_dom: { elements: [], viewport: { width: 1920, height: 1080 } },
          version: '2.0',
        },
        elements: [],
        instruction: 'Test instruction',
        previousActions: [],
      };

      await expect(mockClient.decide(mockContext)).rejects.toThrow('Kimi API failed');
    });
  });

  describe('BrowserLifecycle mock', () => {
    it('should create a mock BrowserLifecycle', () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.getState).toBeDefined();
      expect(mockLifecycle.isOpen).toBeDefined();
      expect(mockLifecycle.getPage).toBeDefined();
      expect(mockLifecycle.open).toBeDefined();
      expect(mockLifecycle.close).toBeDefined();
    });

    it('should handle open and close', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.isOpen()).toBe(false);

      await mockLifecycle.open({ headless: false });

      expect(mockLifecycle.isOpen()).toBe(true);
      expect(mockLifecycle.getState().browser).toBeDefined();

      await mockLifecycle.close();

      expect(mockLifecycle.isOpen()).toBe(false);
      expect(mockLifecycle.getState().browser).toBeNull();
    });

    it('should handle navigate', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      await mockLifecycle.open({ headless: false });

      await mockLifecycle.navigate('https://example.com');

      expect(mockLifecycle.navigate).toHaveBeenCalledWith('https://example.com');
    });

    it('should handle screenshot', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      await mockLifecycle.open({ headless: false });

      const result = await mockLifecycle.screenshot(false);

      expect(result.screenshot).toBeDefined();
      expect(result.viewport).toBeDefined();
    });
  });

  describe('WebSocket mock', () => {
    it('should create a mock WebSocket', () => {
      const mockWs = createWebSocketMock({ initialState: 'OPEN' });

      expect(mockWs.readyState).toBe(1);
      expect(mockWs.send).toBeDefined();
      expect(mockWs.close).toBeDefined();
    });

    it('should simulate WebSocket message', async () => {
      const mockWs = createWebSocketMock({ initialState: 'OPEN' });
      let receivedMessage: string | null = null;

      mockWs.onmessage = (event) => {
        receivedMessage = event.data;
      };

      simulateWebSocketMessage(mockWs, { type: 'test', data: 'hello' });

      expect(receivedMessage).toBe(JSON.stringify({ type: 'test', data: 'hello' }));
    });

    it('should handle send method', () => {
      const mockWs = createWebSocketMock({ initialState: 'OPEN' });

      mockWs.send(JSON.stringify({ type: 'test' }));

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify({ type: 'test' }));
    });

    it('should handle close method', () => {
      const mockWs = createWebSocketMock({ initialState: 'OPEN' });
      let closed = false;

      mockWs.onclose = () => {
        closed = true;
      };

      mockWs.close();

      expect(mockWs.readyState).toBe(3);
      expect(closed).toBe(true);
    });
  });
});
