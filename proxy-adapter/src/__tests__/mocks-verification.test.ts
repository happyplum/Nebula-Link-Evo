import { describe, it, expect } from 'vitest';
import { createKimiClientMock } from '@mocks/KimiClient.mock.js';
import {
  createBrowserContextMock,
  createMockPage,
} from '@mocks/BrowserContext.mock.js';
import {
  createWebSocketMock,
  simulateWebSocketMessage,
} from '@mocks/WebSocket.mock.js';
import type { DecisionContext } from '../clients/types.js';

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

  describe('BrowserContext mock', () => {
    it('should create a mock BrowserContext', () => {
      const mockContext = createBrowserContextMock();

      expect(mockContext.pages).toBeDefined();
      expect(mockContext.newPage).toBeDefined();
      expect(mockContext.close).toBeDefined();
    });

    it('should create a mock Page', async () => {
      const mockContext = createBrowserContextMock();
      const mockPage = await mockContext.newPage();

      expect(mockPage.goto).toBeDefined();
      expect(mockPage.screenshot).toBeDefined();
      expect(mockPage.click).toBeDefined();
      expect(mockPage.url).toBeDefined();
    });

    it('should mock page methods', async () => {
      const mockContext = createBrowserContextMock();
      const mockPage = await mockContext.newPage();

      await mockPage.goto('https://example.com');
      await mockPage.click('#button');

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com');
      expect(mockPage.click).toHaveBeenCalledWith('#button');
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
