import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
 *
 * Migrated from axios HTTP mocks to in-process BrowserService mocks.
 */

// ---------------------------------------------------------------------------
// Mock setup — must be hoisted above the import of browser-client.js
// ---------------------------------------------------------------------------

const mockBrowserService = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(),
  navigate: vi.fn(),
  screenshot: vi.fn(),
  getSimplifiedDOMV2: vi.fn(),
  click: vi.fn(),
  clickBySelector: vi.fn(),
  executeScript: vi.fn(),
  clickByMarker: vi.fn(),
  typeByMarker: vi.fn(),
  focusByMarker: vi.fn(),
  blurByMarker: vi.fn(),
  hoverByMarker: vi.fn(),
  setValueByMarker: vi.fn(),
  dispatchEventByMarker: vi.fn(),
  type: vi.fn(),
  scroll: vi.fn(),
  focus: vi.fn(),
  blur: vi.fn(),
  hover: vi.fn(),
  setValue: vi.fn(),
  dispatchEvent: vi.fn(),
  isOpen: vi.fn(),
  getCurrentUrl: vi.fn(),
  getTitle: vi.fn(),
  getViewport: vi.fn(),
  getTabs: vi.fn(),
  switchTab: vi.fn(),
  getElementAt: vi.fn(),
  getDebugStatus: vi.fn(),
}));

vi.mock('../browser-engine/index.js', () => ({
  BrowserService: {
    getInstance: () => mockBrowserService,
  },
}));

vi.mock('../services/debug-event-hub.js', () => ({
  debugEventHub: { publish: vi.fn() },
}));

vi.mock('../services/logger.js', () => ({
  createWorkerLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { browserClient } from '../browser-client.js';

// Marker result returned by BrowserService on success (no bbox → no debug events)
const SUCCESS_MARKER_RESULT = {
  success: true,
  strategy_used: 'nebula-id',
  attempts: 1,
  latency_ms: 10,
};

describe('Frontend E2E - Marker Mode Operations', () => {
  const mockSnapshotId = 'test-snapshot-123';
  const mockNebulaId = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all marker methods succeed
    mockBrowserService.clickByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.typeByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.focusByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.blurByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.hoverByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.setValueByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.dispatchEventByMarker.mockResolvedValue(SUCCESS_MARKER_RESULT);
    mockBrowserService.getDebugStatus.mockResolvedValue({
      isOpen: false,
      url: null,
      title: null,
      status: 'unknown',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Click Operation', () => {
    it('should execute click marker action successfully', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      expect(mockBrowserService.clickByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.clickByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        'chat'
      );
    });

    it('should handle click marker error', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Element not found'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Element not found');
    });

    it('should validate click parameters', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockBrowserService.clickByMarker.mock.calls[0];
      expect(callArgs[0]).toBe(mockSnapshotId);
      expect(typeof callArgs[0]).toBe('string');
      expect(callArgs[1]).toBe(mockNebulaId);
      expect(typeof callArgs[1]).toBe('number');
    });
  });

  describe('2. Type Operation', () => {
    const testText = 'Hello World';

    it('should execute type marker action successfully', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText);

      expect(mockBrowserService.typeByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.typeByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        testText,
        undefined,
        'chat'
      );
    });

    it('should handle type marker error', async () => {
      mockBrowserService.typeByMarker.mockRejectedValueOnce(new Error('Input failed'));

      await expect(
        browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText)
      ).rejects.toThrow('Input failed');
    });

    it('should validate type parameters', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, testText);

      const callArgs = mockBrowserService.typeByMarker.mock.calls[0];
      expect(callArgs[0]).toBe(mockSnapshotId);
      expect(callArgs[1]).toBe(mockNebulaId);
      expect(callArgs[2]).toBe(testText);
    });
  });

  describe('3. Focus Operation', () => {
    it('should execute focus marker action successfully', async () => {
      await browserClient.focusByMarker(mockSnapshotId, mockNebulaId);

      expect(mockBrowserService.focusByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.focusByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        'chat'
      );
    });

    it('should handle focus marker error', async () => {
      mockBrowserService.focusByMarker.mockRejectedValueOnce(new Error('Focus failed'));

      await expect(
        browserClient.focusByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Focus failed');
    });

    it('should not include param for focus action', async () => {
      await browserClient.focusByMarker(mockSnapshotId, mockNebulaId);

      // focusByMarker(snapshotId, nebulaId, owner) — only 3 args, no text/param
      const callArgs = mockBrowserService.focusByMarker.mock.calls[0];
      expect(callArgs).toHaveLength(3);
    });
  });

  describe('4. Blur Operation', () => {
    it('should execute blur marker action successfully', async () => {
      await browserClient.blurByMarker(mockSnapshotId, mockNebulaId);

      expect(mockBrowserService.blurByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.blurByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        'chat'
      );
    });

    it('should handle blur marker error', async () => {
      mockBrowserService.blurByMarker.mockRejectedValueOnce(new Error('Blur failed'));

      await expect(
        browserClient.blurByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Blur failed');
    });

    it('should not include param for blur action', async () => {
      await browserClient.blurByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockBrowserService.blurByMarker.mock.calls[0];
      expect(callArgs).toHaveLength(3);
    });
  });

  describe('5. Hover Operation', () => {
    it('should execute hover marker action successfully', async () => {
      await browserClient.hoverByMarker(mockSnapshotId, mockNebulaId);

      expect(mockBrowserService.hoverByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.hoverByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        'chat'
      );
    });

    it('should handle hover marker error', async () => {
      mockBrowserService.hoverByMarker.mockRejectedValueOnce(new Error('Hover failed'));

      await expect(
        browserClient.hoverByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Hover failed');
    });

    it('should not include param for hover action', async () => {
      await browserClient.hoverByMarker(mockSnapshotId, mockNebulaId);

      const callArgs = mockBrowserService.hoverByMarker.mock.calls[0];
      expect(callArgs).toHaveLength(3);
    });
  });

  describe('6. Value Operation', () => {
    const testValue = 'test-value-123';

    it('should execute setValue marker action successfully', async () => {
      await browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue);

      expect(mockBrowserService.setValueByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.setValueByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        testValue,
        'chat'
      );
    });

    it('should handle setValue marker error', async () => {
      mockBrowserService.setValueByMarker.mockRejectedValueOnce(new Error('SetValue failed'));

      await expect(
        browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue)
      ).rejects.toThrow('SetValue failed');
    });

    it('should validate value parameters', async () => {
      await browserClient.setValueByMarker(mockSnapshotId, mockNebulaId, testValue);

      const callArgs = mockBrowserService.setValueByMarker.mock.calls[0];
      expect(callArgs[0]).toBe(mockSnapshotId);
      expect(callArgs[1]).toBe(mockNebulaId);
      expect(callArgs[2]).toBe(testValue);
    });
  });

  describe('7. Dispatch Event Operation', () => {
    const testEventType = 'change';

    it('should execute dispatchEvent marker action successfully', async () => {
      await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType);

      expect(mockBrowserService.dispatchEventByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.dispatchEventByMarker).toHaveBeenCalledWith(
        mockSnapshotId,
        mockNebulaId,
        testEventType,
        'chat'
      );
    });

    it('should handle dispatchEvent marker error', async () => {
      mockBrowserService.dispatchEventByMarker.mockRejectedValueOnce(new Error('Dispatch failed'));

      await expect(
        browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType)
      ).rejects.toThrow('Dispatch failed');
    });

    it('should validate dispatch parameters', async () => {
      await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, testEventType);

      const callArgs = mockBrowserService.dispatchEventByMarker.mock.calls[0];
      expect(callArgs[0]).toBe(mockSnapshotId);
      expect(callArgs[1]).toBe(mockNebulaId);
      expect(callArgs[2]).toBe(testEventType);
    });

    it('should support various event types', async () => {
      const eventTypes = ['click', 'change', 'submit', 'input', 'focus', 'blur'];

      for (const eventType of eventTypes) {
        mockBrowserService.dispatchEventByMarker.mockClear();
        await browserClient.dispatchEventByMarker(mockSnapshotId, mockNebulaId, eventType);

        const callArgs = mockBrowserService.dispatchEventByMarker.mock.calls[0];
        expect(callArgs[2]).toBe(eventType);
      }
    });
  });

  describe('BrowserService Call Pattern Verification', () => {
    it('should call clickByMarker for click operation', async () => {
      await browserClient.clickByMarker(mockSnapshotId, mockNebulaId);

      expect(mockBrowserService.clickByMarker).toHaveBeenCalledTimes(1);
      // Other marker methods should NOT be called
      expect(mockBrowserService.typeByMarker).not.toHaveBeenCalled();
    });

    it('should call correct BrowserService method for each marker operation', async () => {
      const operations: Array<{ method: string; bsMethod: string; args: unknown[] }> = [
        { method: 'typeByMarker', bsMethod: 'typeByMarker', args: [mockSnapshotId, mockNebulaId, 'text'] },
        { method: 'focusByMarker', bsMethod: 'focusByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'blurByMarker', bsMethod: 'blurByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'hoverByMarker', bsMethod: 'hoverByMarker', args: [mockSnapshotId, mockNebulaId] },
        { method: 'setValueByMarker', bsMethod: 'setValueByMarker', args: [mockSnapshotId, mockNebulaId, 'value'] },
        { method: 'dispatchEventByMarker', bsMethod: 'dispatchEventByMarker', args: [mockSnapshotId, mockNebulaId, 'click'] },
      ];

      for (const op of operations) {
        vi.clearAllMocks();
        await (browserClient as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>)[op.method](...op.args);

        const bsMock = (mockBrowserService as unknown as Record<string, ReturnType<typeof vi.fn>>)[op.bsMethod];
        expect(bsMock).toHaveBeenCalledTimes(1);
      }
    });

    it('should include snapshot_id and nebula_id in all marker calls', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, 'test');

      const callArgs = mockBrowserService.typeByMarker.mock.calls[0];
      expect(typeof callArgs[0]).toBe('string'); // snapshot_id
      expect(typeof callArgs[1]).toBe('number'); // nebula_id
    });
  });

  describe('Error Scenarios', () => {
    it('should handle network/browser errors gracefully', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Network Error'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Network Error');
    });

    it('should handle timeout errors', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Timeout of 30000ms exceeded'));

      await expect(
        browserClient.clickByMarker(mockSnapshotId, mockNebulaId)
      ).rejects.toThrow('Timeout');
    });

    it('should handle invalid snapshot ID', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Invalid snapshot'));

      await expect(
        browserClient.clickByMarker('invalid-snapshot', mockNebulaId)
      ).rejects.toThrow('Invalid snapshot');
    });

    it('should handle invalid nebula ID', async () => {
      mockBrowserService.clickByMarker.mockRejectedValueOnce(new Error('Element not found'));

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

      expect(mockBrowserService.clickByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.typeByMarker).toHaveBeenCalledTimes(1);
      expect(mockBrowserService.focusByMarker).toHaveBeenCalledTimes(1);
    });

    it('should maintain operation order in sequential execution', async () => {
      await browserClient.clickByMarker(mockSnapshotId, 1);
      await browserClient.typeByMarker(mockSnapshotId, 2, 'text');
      await browserClient.focusByMarker(mockSnapshotId, 3);

      // Each method called once with correct nebula_id
      expect(mockBrowserService.clickByMarker.mock.calls[0][1]).toBe(1);
      expect(mockBrowserService.typeByMarker.mock.calls[0][1]).toBe(2);
      expect(mockBrowserService.focusByMarker.mock.calls[0][1]).toBe(3);
    });
  });

  describe('Parameter Validation', () => {
    it('should accept string snapshot_id', async () => {
      await browserClient.clickByMarker('string-snapshot-id', mockNebulaId);

      const callArgs = mockBrowserService.clickByMarker.mock.calls[0];
      expect(typeof callArgs[0]).toBe('string');
    });

    it('should accept number nebula_id', async () => {
      await browserClient.clickByMarker(mockSnapshotId, 123);

      const callArgs = mockBrowserService.clickByMarker.mock.calls[0];
      expect(typeof callArgs[1]).toBe('number');
    });

    it('should accept string param for type operation', async () => {
      await browserClient.typeByMarker(mockSnapshotId, mockNebulaId, 'test string');

      const callArgs = mockBrowserService.typeByMarker.mock.calls[0];
      expect(typeof callArgs[2]).toBe('string');
    });
  });
});
