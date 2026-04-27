import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserClient } from '../browser-client.js';
import type { Action } from '../config/schema.js';
import { TaskService } from '../services/index.js';
import { interactionLogger } from '../services/interaction-logger.js';

describe('TaskService interaction logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should log successful action execution', async () => {
    vi.spyOn(browserClient, 'click').mockResolvedValue(undefined);
    const logSpy = vi.spyOn(interactionLogger, 'log').mockResolvedValue(undefined);

    const action: Action = {
      type: 'click',
      params: { x: 120, y: 260 },
    };

    const result = await TaskService.getInstance().executeAction(action);

    expect(result.success).toBe(true);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'click',
        target_type: 'coordinates',
        locator_strategy: 'coordinates',
        success: true,
        attempts: 1,
        latency_ms: expect.any(Number),
      })
    );
  });

  it('should log failed action execution with error fields', async () => {
    vi.spyOn(browserClient, 'click').mockRejectedValue(new Error('click failed'));
    const logSpy = vi.spyOn(interactionLogger, 'log').mockResolvedValue(undefined);

    const action: Action = {
      type: 'click',
      params: { x: 120, y: 260 },
    };

    const result = await TaskService.getInstance().executeAction(action);

    expect(result.success).toBe(false);
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action_type: 'click',
        target_type: 'coordinates',
        locator_strategy: 'coordinates',
        success: false,
        attempts: 1,
        latency_ms: expect.any(Number),
        error_code: 'ACTION_EXECUTION_FAILED',
        error_message: expect.stringContaining('click failed'),
      })
    );
  });
});
