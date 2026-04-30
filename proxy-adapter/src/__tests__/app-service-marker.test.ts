import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AppService } from '../services/index.js';
import { browserClient } from '../browser-client.js';
import type { Action } from '../config/schema.js';
import { failureSampleCollector } from '../services/failure-sample-collector.js';

describe('AppService - Marker Operations', () => {
  const mockSnapshotId = 'snapshot-123';
  const mockNebulaId = 42;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    vi.spyOn(browserClient, 'getStatus').mockResolvedValue({ isOpen: true, url: 'test' });
    vi.spyOn(failureSampleCollector, 'saveFailureSample').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('click marker operation', () => {
    it('should execute click marker action with resolved_target type marker', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: mockNebulaId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe(`Clicked marker: ${mockSnapshotId}/${mockNebulaId}`);
      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });

    it('should execute click marker action with resolved_target format target_id', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: mockSnapshotId,
            target_id: mockNebulaId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(true);
      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });

    it('should fall back to params when resolved_target not provided', async () => {
      const action: Action = {
        type: 'click',
        params: {
          snapshot_id: mockSnapshotId,
          target_id: mockNebulaId,
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Click action requires x,y, marker target, or selector');
    });

    it('should fail when marker action lacks required params', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Marker action requires snapshot_id and nebula_id');
    });
  });

  describe('selector fallback', () => {
    it('should use selector click when resolved_target type is selector', async () => {
      const clickSelectorSpy = vi.spyOn(browserClient, 'clickBySelector').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'selector',
            selector: '#test-button',
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSelectorSpy).toHaveBeenCalledWith('#test-button');
    });

    it('should use selector click when resolved_target format is selector', async () => {
      const clickSelectorSpy = vi.spyOn(browserClient, 'clickBySelector').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'selector',
            selector: '#submit-btn',
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSelectorSpy).toHaveBeenCalledWith('#submit-btn');
    });
  });

  describe('marker operation error handling', () => {
    it('should handle clickByMarker error', async () => {
      vi.spyOn(browserClient, 'clickByMarker').mockRejectedValue(new Error('Marker click failed'));

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: mockNebulaId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Marker click failed');
    });

    it('should handle missing snapshot_id', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            nebula_id: mockNebulaId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Marker action requires snapshot_id and nebula_id');
    });

    it('should handle missing nebula_id', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Marker action requires snapshot_id and nebula_id');
    });

    it('should handle invalid nebula_id type', async () => {
      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: 'invalid' as any,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
    });

    it('should handle clickBySelector error', async () => {
      vi.spyOn(browserClient, 'clickBySelector').mockRejectedValue(new Error('Selector click failed'));

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'selector',
            selector: '#test',
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Selector click failed');
    });
  });

  describe('marker format detection', () => {
    it('should detect marker format from resolved_target.type', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: mockNebulaId,
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });

    it('should detect marker format from resolved_target.format', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            format: 'target_id',
            snapshot_id: mockSnapshotId,
            target_id: mockNebulaId,
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });

    it('should prefer resolved_target.nebula_id over target_id', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: 100,
            target_id: 200,
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, 100);
    });

    it('should use target_id as fallback when nebula_id not provided', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            target_id: mockNebulaId,
          },
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });

    it('should fall back to action.params when resolved_target values missing', async () => {
      const clickSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          resolved_target: {
            type: 'marker',
          },
          snapshot_id: mockSnapshotId,
          target_id: mockNebulaId,
        },
      };

      await AppService.getInstance().executeAction(action);

      expect(clickSpy).toHaveBeenCalledWith(mockSnapshotId, mockNebulaId);
    });
  });

  describe('coordinate-based click (non-marker)', () => {
    it('should execute coordinate click when x,y provided', async () => {
      const clickSpy = vi.spyOn(browserClient, 'click').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          x: 100,
          y: 200,
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Clicked at (100, 200)');
      expect(clickSpy).toHaveBeenCalledWith(100, 200);
    });

    it('should prioritize coordinates over resolved_target', async () => {
      const clickSpy = vi.spyOn(browserClient, 'click').mockResolvedValue(undefined);
      const clickMarkerSpy = vi.spyOn(browserClient, 'clickByMarker').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          x: 50,
          y: 60,
          resolved_target: {
            type: 'marker',
            snapshot_id: mockSnapshotId,
            nebula_id: mockNebulaId,
          },
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Clicked at (50, 60)');
      expect(clickSpy).toHaveBeenCalledWith(50, 60);
      expect(clickMarkerSpy).not.toHaveBeenCalled();
    });
  });

  describe('selector-based click (non-marker)', () => {
    it('should execute selector click when selector provided without resolved_target', async () => {
      const clickSelectorSpy = vi.spyOn(browserClient, 'clickBySelector').mockResolvedValue(undefined);

      const action: Action = {
        type: 'click',
        params: {
          selector: '#my-button',
        },
      };

      const result = await AppService.getInstance().executeAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Clicked selector: #my-button');
      expect(clickSelectorSpy).toHaveBeenCalledWith('#my-button');
    });
  });
});
