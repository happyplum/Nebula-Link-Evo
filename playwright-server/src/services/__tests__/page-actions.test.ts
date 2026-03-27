import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageActions } from '../page-actions.js';
import { ClickResolutionService } from '../click-resolution.js';

vi.mock('../click-resolution.js', () => {
  return {
    ClickResolutionService: vi.fn().mockImplementation(function() {
      return {
        resolveTarget: vi.fn().mockResolvedValue({
          locators: ['#test-id', '.test-class'],
          target: { nebula_id: '123' }
        }),
        executeWithFallback: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

describe('PageActions', () => {
  let pageActions: PageActions;
  let mockPage: any;

  beforeEach(() => {
    pageActions = new PageActions();
    
    mockPage = {
      mouse: {
        click: vi.fn().mockResolvedValue(undefined)
      },
      locator: vi.fn().mockReturnValue({
        click: vi.fn().mockResolvedValue(undefined),
        elementHandle: vi.fn().mockResolvedValue({})
      }),
      evaluate: vi.fn().mockResolvedValue(undefined),
      fill: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      focus: vi.fn().mockResolvedValue(undefined),
      hover: vi.fn().mockResolvedValue(undefined)
    };
    
    pageActions.setPage(mockPage);
    vi.clearAllMocks();
  });

  describe('requirePage', () => {
    it('should throw error if page is not set', async () => {
      const emptyActions = new PageActions();
      await expect(emptyActions.click(0, 0)).rejects.toThrow('Browser not opened');
    });
  });

  describe('click', () => {
    it('should call page.mouse.click with coordinates', async () => {
      await pageActions.click(100, 200);
      expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200);
    });
  });

  describe('clickBySelector', () => {
    it('should call locator.click with options', async () => {
      await pageActions.clickBySelector('#test', { button: 'right', clickCount: 2, delay: 100 });
      expect(mockPage.locator).toHaveBeenCalledWith('#test');
      expect(mockPage.locator().click).toHaveBeenCalledWith({
        button: 'right',
        clickCount: 2,
        delay: 100
      });
    });

    it('should use evaluate when force option is true', async () => {
      await pageActions.clickBySelector('#test', { force: true });
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('clickByMarker', () => {
    it('should resolve target and execute with fallback', async () => {
      const result = await pageActions.clickByMarker('snap-1', 123);
      if (!result.success) console.error(result.error);
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
      expect(result.strategy_used).toBe('nebula-id');
    });

    it('should handle errors and return error result', async () => {
      const error = new Error('Element not found');
      vi.mocked(ClickResolutionService).mockImplementationOnce(function() {
        return {
          resolveTarget: vi.fn().mockRejectedValue(error),
          executeWithFallback: vi.fn()
        } as any;
      });

      const result = await pageActions.clickByMarker('snap-1', 123);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('element_not_found');
      expect(result.error?.message).toBe('Element not found');
    });
  });

  describe('type', () => {
    it('should fill and type text', async () => {
      await pageActions.type('#test', 'hello', { delay: 50 });
      expect(mockPage.fill).toHaveBeenCalledWith('#test', '');
      expect(mockPage.type).toHaveBeenCalledWith('#test', 'hello', { delay: 50 });
    });

    it('should not clear if clear option is false', async () => {
      await pageActions.type('#test', 'hello', { clear: false });
      expect(mockPage.fill).not.toHaveBeenCalled();
      expect(mockPage.type).toHaveBeenCalledWith('#test', 'hello', { delay: undefined });
    });

    it('should use evaluate when force option is true', async () => {
      await pageActions.type('#test', 'hello', { force: true });
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('typeByMarker', () => {
    it('should resolve target and type text', async () => {
      const result = await pageActions.typeByMarker('snap-1', 123, 'hello');
      expect(result.success).toBe(true);
      expect(mockPage.fill).toHaveBeenCalledWith('#test-id', '');
      expect(mockPage.type).toHaveBeenCalledWith('#test-id', 'hello', { delay: undefined });
    });
  });

  describe('scroll', () => {
    it('should call evaluate to scroll', async () => {
      await pageActions.scroll(0, 500);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('focus', () => {
    it('should call page.focus', async () => {
      await pageActions.focus('#test');
      expect(mockPage.focus).toHaveBeenCalledWith('#test');
    });
  });

  describe('focusByMarker', () => {
    it('should resolve target and focus', async () => {
      const result = await pageActions.focusByMarker('snap-1', 123);
      expect(result.success).toBe(true);
      expect(mockPage.focus).toHaveBeenCalledWith('#test-id');
    });
  });

  describe('blur', () => {
    it('should call evaluate to blur', async () => {
      await pageActions.blur('#test');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('blurByMarker', () => {
    it('should resolve target and blur', async () => {
      const result = await pageActions.blurByMarker('snap-1', 123);
      expect(result.success).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('hover', () => {
    it('should call page.hover', async () => {
      await pageActions.hover('#test');
      expect(mockPage.hover).toHaveBeenCalledWith('#test');
    });
  });

  describe('hoverByMarker', () => {
    it('should resolve target and hover', async () => {
      const result = await pageActions.hoverByMarker('snap-1', 123);
      expect(result.success).toBe(true);
      expect(mockPage.hover).toHaveBeenCalledWith('#test-id');
    });
  });

  describe('setValue', () => {
    it('should call evaluate to set value', async () => {
      await pageActions.setValue('#test', 'value');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('setValueByMarker', () => {
    it('should resolve target and set value', async () => {
      const result = await pageActions.setValueByMarker('snap-1', 123, 'value');
      expect(result.success).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('dispatchEvent', () => {
    it('should call evaluate to dispatch event', async () => {
      await pageActions.dispatchEvent('#test', 'change');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('dispatchEventByMarker', () => {
    it('should resolve target and dispatch event', async () => {
      const result = await pageActions.dispatchEventByMarker('snap-1', 123, 'change');
      expect(result.success).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });

  describe('executeScript', () => {
    it('should call evaluate with script', async () => {
      mockPage.evaluate.mockResolvedValueOnce('result');
      const result = await pageActions.executeScript('return "result"');
      expect(result).toBe('result');
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    it('should throw error if evaluate fails', async () => {
      mockPage.evaluate.mockRejectedValueOnce(new Error('Script error'));
      await expect(pageActions.executeScript('invalid')).rejects.toThrow('Script execution failed: Script error');
    });
  });

  describe('getElementAt', () => {
    it('should call evaluate to get element info', async () => {
      mockPage.evaluate.mockResolvedValueOnce({ tag: 'div' });
      const result = await pageActions.getElementAt(100, 200);
      expect(result).toEqual({ tag: 'div' });
      expect(mockPage.evaluate).toHaveBeenCalled();
    });
  });
});
