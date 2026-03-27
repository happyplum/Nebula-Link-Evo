import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { browserClient } from '../browser-client.js';

/**
 * Frontend E2E QA 验证测试
 * 测试 Debug UI 的 Marker 模式 7 种操作
 * 
 * 操作类型:
 * - click: 点击
 * - type: 输入文本
 * - focus: 聚焦
 * - blur: 失焦
 * - hover: 悬停
 * - value: 设置值
 * - dispatch: 派发事件
 */

// Mock axios for HTTP requests
vi.mock('axios', () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: { success: true } }),
    get: vi.fn().mockResolvedValue({ data: { success: true } }),
  },
}));

import axios from 'axios';

const mockAxios = axios as unknown as {
  post: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

describe('Frontend E2E - Marker Mode Operations', () => {
  const mockSnapshotId = 'test-snapshot-123';
  const mockNebulaId = 42;
  const PLAYWRIGHT_URL = 'http://localhost:3001';

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.post.mockResolvedValue({ data: { success: true } });
    mockAxios.get.mockResolvedValue({ data: { success: true } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Click Operation', () => {
    it('should execute click marker action successfully', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/click-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
        }
      );
    });

    it('should handle click marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Element not found'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Element not found');
    });

    it('should validate click parameters', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).toHaveProperty('snapshot_id');
      expect(callArgs).toHaveProperty('nebula_id');
      expect(typeof callArgs.snapshot_id).toBe('string');
      expect(typeof callArgs.nebula_id).toBe('number');
    });
  });

  describe('2. Type Operation', () => {
    const testText = 'Hello World';

    it('should execute type marker action successfully', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'type',
          param: testText,
        }
      );
    });

    it('should handle type marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Input failed'));

      await expect(
        browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText)
      ).rejects.toThrow('Input failed');
    });

    it('should validate type parameters', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).toHaveProperty('action', 'type');
      expect(callArgs).toHaveProperty('param', testText);
    });
  });

  describe('3. Focus Operation', () => {
    it('should execute focus marker action successfully', async () => {
      await browserClient.focusByMarker(mockSnapshotId, mockNebulaId);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'focus',
        }
      );
    });

    it('should handle focus marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Focus failed'));

      await expect(
        browserClient.focusByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Focus failed');
    });

    it('should not include param for focus action', async () => {
      await browserClient.focusByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('param');
    });
  });

  describe('4. Blur Operation', () => {
    it('should execute blur marker action successfully', async () => {
      await browserClient.blurByMarker(mockSnapshotId, mockNebulaId);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'blur',
        }
      );
    });

    it('should handle blur marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Blur failed'));

      await expect(
        browserClient.blurByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Blur failed');
    });

    it('should not include param for blur action', async () => {
      await browserClient.blurByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('param');
    });
  });

  describe('5. Hover Operation', () => {
    it('should execute hover marker action successfully', async () => {
      await browserClient.hoverByMarker(mockSnapshotId, mockNebulaId);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'hover',
        }
      );
    });

    it('should handle hover marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Hover failed'));

      await expect(
        browserClient.hoverByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Hover failed');
    });

    it('should not include param for hover action', async () => {
      await browserClient.hoverByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).not.toHaveProperty('param');
    });
  });

  describe('6. Value Operation', () => {
    const testValue = 'test-value-123';

    it('should execute setValue marker action successfully', async () => {
      await browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'value',
          param: testValue,
        }
      );
    });

    it('should handle setValue marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('SetValue failed'));

      await expect(
        browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue)
      ).rejects.toThrow('SetValue failed');
    });

    it('should validate value parameters', async () => {
      await browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).toHaveProperty('action', 'value');
      expect(callArgs).toHaveProperty('param', testValue);
    });
  });

  describe('7. Dispatch Event Operation', () => {
    const testEventType = 'change';

    it('should execute dispatchEvent marker action successfully', async () => {
      await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType);

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${PLAYWRIGHT_URL}/action/execute-by-marker`,
        {
          snapshot_id: mockSnapshotId,
          nebula_id: mockNebulaId,
          action: 'dispatch',
          param: testEventType,
        }
      );
    });

    it('should handle dispatchEvent marker error', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Dispatch failed'));

      await expect(
        browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType)
      ).rejects.toThrow('Dispatch failed');
    });

    it('should validate dispatch parameters', async () => {
      await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType);

      const callArgs = mockAxios.post.mock.calls[0][1];
      expect(callArgs).toHaveProperty('action', 'dispatch');
      expect(callArgs).toHaveProperty('param', testEventType);
    });

    it('should support various event types', async () => {
      const eventTypes = ['click', 'change', 'submit', 'input', 'focus', 'blur'];

      for (const eventType of eventTypes) {
        mockAxios.post.mockClear();
        await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, eventType);

        const callArgs = mockAxios.post.mock.calls[0][1];
        expect(callArgs.param).toBe(eventType);
      }
    });
  });

  describe('API Call Pattern Verification', () => {
    it('should use correct endpoint for click-by-marker', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      const endpoint = mockAxios.post.mock.calls[0][0];
      expect(endpoint).toBe(`${PLAYWRIGHT_URL}/action/click-by-marker`);
    });

    it('should use unified execute-by-marker endpoint for other operations', async () => {
      const operations = [
        { method: 'typeByMarker', args: [mockSnapshotId, mockNebulaId, 'text'] },
        { method: 'focusByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'blurByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'hoverByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'setValueByMarker', args: [mockSnapshotId, mockNebulaId, 'value'] },
        { method: 'dispatchEventByMarker', args: [mockSnapshotId, mockNebulaId, 'click'] },
      ];

      for (const op of operations) {
        mockAxios.post.mockClear();
        await (browserClient as unknown as Record<string, Function>)[op.method](...op.args);

        const endpoint = mockAxios.post.mock.calls[0][0];
        expect(endpoint).toBe(`${PLAYWRIGHT_URL}/action/execute-by-marker`);
      }
    });

    it('should include all required fields in request body', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, 'test');

      const body = mockAxios.post.mock.calls[0][1];
      expect(body).toMatchObject({
        snapshot_id: expect.any(String),
        nebula_id: expect.any(Number),
        action: expect.any(String),
      });
    });
  });

  describe('Error Scenarios', () => {
    it('should handle network errors gracefully', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Network Error'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Network Error');
    });

    it('should handle timeout errors', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Timeout of 30000ms exceeded'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Timeout');
    });

    it('should handle invalid snapshot ID', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Invalid snapshot'));

      await expect(
        browserClient.clickByMarker('invalid-snapshot', mockNebulaId)
      ).rejects.toThrow('Invalid snapshot');
    });

    it('should handle invalid nebula ID', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Element not found'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, 999999)
      ).rejects.toThrow('Element not found');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent operations', async () => {
      const operations = [
        browserClient.clickByMarker(mockSnapshotId, 1),
        browserClient.typeByMarker(mockSnapshotId, 2, 'text'),
        browserClient.focusByMarker(mockSnapshotId, 3),
      ];

      await Promise.all(operations);

      expect(mockAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should maintain operation order in sequential execution', async () => {
      await browserClient.clickByMarker(mockSnapshotId, 1);
      await browserClient.typeByMarker(mockSnapshotId, 2, 'text');
      await browserClient.focusByMarker(mockSnapshotId, 3);

      expect(mockAxios.post).toHaveBeenCalledTimes(3);

      const calls = mockAxios.post.mock.calls;
      expect(calls[0][1].nebula_id).toBe(1);
      expect(calls[1][1].nebula_id).toBe(2);
      expect(calls[2][1].nebula_id).toBe(3);
    });
  });

  describe('Parameter Validation', () => {
    it('should accept string snapshot_id', async () => {
      await browserClient.clickByMarker('string-snapshot-id', mockNebulaId);

      const body = mockAxios.post.mock.calls[0][1];
      expect(typeof body.snapshot_id).toBe('string');
    });

    it('should accept number nebula_id', async () => {
      await browserClient.clickByMarker(mockSnapshotId, 123);

      const body = mockAxios.post.mock.calls[0][1];
      expect(typeof body.nebula_id).toBe('number');
    });

    it('should accept string param for type operation', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, 'test string');

      const body = mockAxios.post.mock.calls[0][1];
      expect(typeof body.param).toBe('string');
    });
  });
});