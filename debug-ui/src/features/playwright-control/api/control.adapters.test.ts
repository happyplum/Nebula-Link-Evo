import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeAction,
  evaluateExpression,
  takeScreenshot,
  getElements,
  getConsoleMessages,
} from './control.adapters.js';

// Mock the apiClient module
vi.mock('@/shared/api/client.js', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

import { apiClient } from '@/shared/api/client.js';

const mockPost = vi.mocked(apiClient.post);
const mockGet = vi.mocked(apiClient.get);

describe('control.adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeAction', () => {
    it('posts action to the action endpoint', async () => {
      const response = { success: true, message: 'ok' };
      mockPost.mockResolvedValue(response);

      const result = await executeAction('click', { selector: '#btn' });

      expect(mockPost).toHaveBeenCalledWith('/debug/api/playwright/action', {
        action: 'click',
        selector: '#btn',
      });
      expect(result).toEqual(response);
    });

    it('posts action without extra args', async () => {
      const response = { success: true };
      mockPost.mockResolvedValue(response);

      const result = await executeAction('reload');

      expect(mockPost).toHaveBeenCalledWith('/debug/api/playwright/action', {
        action: 'reload',
      });
      expect(result.success).toBe(true);
    });

    it('propagates error responses', async () => {
      const response = { success: false, error: 'Not connected' };
      mockPost.mockResolvedValue(response);

      const result = await executeAction('click', { selector: '#btn' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Not connected');
    });
  });

  describe('evaluateExpression', () => {
    it('posts expression to the evaluate endpoint', async () => {
      const response = { success: true, result: 42 };
      mockPost.mockResolvedValue(response);

      const result = await evaluateExpression('document.title');

      expect(mockPost).toHaveBeenCalledWith(
        '/debug/api/playwright/evaluate',
        { expression: 'document.title' },
      );
      expect(result.result).toBe(42);
    });

    it('handles evaluation errors', async () => {
      const response = { success: false, error: 'SyntaxError' };
      mockPost.mockResolvedValue(response);

      const result = await evaluateExpression('invalid///');

      expect(result.success).toBe(false);
      expect(result.error).toBe('SyntaxError');
    });
  });

  describe('takeScreenshot', () => {
    it('gets screenshot without selector', async () => {
      const response = {
        success: true,
        screenshot: 'base64data',
        viewport: { width: 1280, height: 720 },
      };
      mockGet.mockResolvedValue(response);

      const result = await takeScreenshot();

      expect(mockGet).toHaveBeenCalledWith(
        '/debug/api/playwright/screenshot',
        undefined,
      );
      expect(result.screenshot).toBe('base64data');
      expect(result.viewport).toEqual({ width: 1280, height: 720 });
    });

    it('gets screenshot with selector param', async () => {
      const response = { success: true, screenshot: 'partial' };
      mockGet.mockResolvedValue(response);

      const result = await takeScreenshot('#header');

      expect(mockGet).toHaveBeenCalledWith('/debug/api/playwright/screenshot', {
        selector: '#header',
      });
      expect(result.screenshot).toBe('partial');
    });
  });

  describe('getElements', () => {
    it('gets elements matching selector', async () => {
      const elements = [
        { tag: 'button', text: 'Submit', isVisible: true, isInteractable: true },
      ];
      const response = { success: true, elements };
      mockGet.mockResolvedValue(response);

      const result = await getElements('button');

      expect(mockGet).toHaveBeenCalledWith('/debug/api/playwright/elements', {
        selector: 'button',
      });
      expect(result.elements).toEqual(elements);
    });

    it('handles empty results', async () => {
      const response = { success: true, elements: [] };
      mockGet.mockResolvedValue(response);

      const result = await getElements('.nonexistent');

      expect(result.elements).toEqual([]);
    });
  });

  describe('getConsoleMessages', () => {
    it('gets accumulated console messages', async () => {
      const messages = [
        { type: 'log', text: 'hello', timestamp: 1000 },
        { type: 'error', text: 'fail', timestamp: 2000 },
      ];
      const response = { success: true, messages };
      mockGet.mockResolvedValue(response);

      const result = await getConsoleMessages();

      expect(mockGet).toHaveBeenCalledWith('/debug/api/playwright/console');
      expect(result.messages).toEqual(messages);
    });

    it('handles error response', async () => {
      const response = { success: false, error: 'Browser not open' };
      mockGet.mockResolvedValue(response);

      const result = await getConsoleMessages();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Browser not open');
    });
  });
});
