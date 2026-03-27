import { describe, it, expect } from 'vitest';
import { createKimiClientMock, createBrowserLifecycleMock } from '../../../shared/test-utils/index.js';
import { createWebSocketMock, simulateWebSocketMessage } from '@mocks/WebSocket.mock.js';
import type { DecisionContext } from '../../clients/types.js';

describe('Mock imports from shared/test-utils', () => {
  describe('KimiClient mock', () => {
    it('should import and create KimiClient mock', () => {
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
  });

  describe('BrowserLifecycle mock', () => {
    it('should import and create BrowserLifecycle mock', () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.getState).toBeDefined();
      expect(mockLifecycle.isOpen).toBeDefined();
      expect(mockLifecycle.open).toBeDefined();
      expect(mockLifecycle.close).toBeDefined();
    });

    it('should handle open and close', async () => {
      const mockLifecycle = createBrowserLifecycleMock();

      expect(mockLifecycle.isOpen()).toBe(false);

      await mockLifecycle.open({ headless: false });

      expect(mockLifecycle.isOpen()).toBe(true);

      await mockLifecycle.close();

      expect(mockLifecycle.isOpen()).toBe(false);
    });
  });

  describe('WebSocket mock', () => {
    it('should import and create WebSocket mock', () => {
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
  });
});
