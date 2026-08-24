import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserClient } from '../browser-client.js';
import { TOOL_DEFINITIONS } from '../browser-tools/definitions.js';
import { BrowserToolsProvider } from '../tools/providers/browser-tools-provider.js';

/**
 * 创建带 vi.fn() mock 方法的 BrowserClient
 * 覆盖 executeTool 中用到的所有 BrowserClient 方法
 */
function makeMockBrowserClient(): BrowserClient {
  return {
    openBrowser: vi.fn().mockResolvedValue(undefined),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue({ data: 'base64-png-data', type: 'png' }),
    getStatus: vi.fn().mockResolvedValue({ isOpen: true, url: 'https://example.com' }),
    click: vi.fn().mockResolvedValue(undefined),
    clickBySelector: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    elementAction: vi.fn().mockResolvedValue(undefined),
    getSimplifiedDOM: vi.fn().mockResolvedValue({ elements: [] }),
    executeScript: vi.fn().mockResolvedValue({ result: 42 }),
    getTabs: vi.fn().mockResolvedValue([{ id: 'tab-1', title: 'Test' }]),
    switchTab: vi.fn().mockResolvedValue(undefined),
    clickByMarker: vi.fn().mockResolvedValue(undefined),
    typeByMarker: vi.fn().mockResolvedValue(undefined),
    focusByMarker: vi.fn().mockResolvedValue(undefined),
    blurByMarker: vi.fn().mockResolvedValue(undefined),
    hoverByMarker: vi.fn().mockResolvedValue(undefined),
    setValueByMarker: vi.fn().mockResolvedValue(undefined),
    dispatchEventByMarker: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserClient;
}

// ─── 结构测试（原始测试，mock createBrowserTools 验证 Provider 装配逻辑） ───

describe('BrowserToolsProvider (structural)', () => {
  let provider: BrowserToolsProvider;

  beforeEach(async () => {
    const mockToolMap: Record<string, { execute: (args: unknown) => Promise<string> }> = {};
    for (const def of TOOL_DEFINITIONS) {
      mockToolMap[def.name] = { execute: vi.fn(async () => `${def.name}-ok`) };
    }

    vi.doMock('../browser-tools/index.js', () => ({
      createBrowserTools: vi.fn(() => mockToolMap),
    }));

    // 重新 import 以应用 doMock
    vi.resetModules();
    vi.doMock('../browser-tools/index.js', () => ({
      createBrowserTools: vi.fn(() => mockToolMap),
    }));

    const { BrowserToolsProvider: BTP } =
      await import('../tools/providers/browser-tools-provider.js');
    provider = new BTP(makeMockBrowserClient());
  });

  afterEach(() => {
    vi.doUnmock('../browser-tools/index.js');
    vi.resetModules();
  });

  it('should have id "browser-tools" and status "initializing" before init', () => {
    expect(provider.id).toBe('browser-tools');
    expect(provider.status).toBe('initializing');
  });

  it('should return empty tools before initialization', () => {
    expect(provider.getTools()).toHaveLength(0);
  });

  describe('initialize', () => {
    it('should produce one GatewayTool per TOOL_DEFINITIONS entry', async () => {
      await provider.initialize();

      expect(provider.status).toBe('ready');
      const tools = provider.getTools();
      expect(tools).toHaveLength(TOOL_DEFINITIONS.length);

      for (const tool of tools) {
        expect(tool.exposeTo).toEqual([]);
        expect(tool.providerId).toBe('browser-tools');
      }
    });

    it('should produce tools with matching names from definitions', async () => {
      await provider.initialize();

      const toolNames = provider.getTools().map((t) => t.name);
      const defNames = TOOL_DEFINITIONS.map((d) => d.name);
      expect(toolNames.sort()).toEqual(defNames.sort());
    });
  });

  describe('shutdown', () => {
    it('should set status to disabled and clear tools', async () => {
      await provider.shutdown();

      expect(provider.status).toBe('disabled');
      expect(provider.getTools()).toHaveLength(0);
    });
  });
});

// ─── 执行测试（使用真实 createBrowserTools + mock BrowserClient） ───

describe('BrowserToolsProvider (execution)', () => {
  let provider: BrowserToolsProvider;
  let mockClient: BrowserClient;

  beforeEach(async () => {
    mockClient = makeMockBrowserClient();
    provider = new BrowserToolsProvider(mockClient);
    await provider.initialize();
  });

  /** 通过工具名查找并执行工具 */
  function findAndExecute(name: string, args: unknown): Promise<string> {
    const tool = provider.getTools().find((t) => t.name === name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.execute(args);
  }

  // --- 正常执行路径 ---

  describe('browser_open', () => {
    it('should call openBrowser and return result', async () => {
      const result = await findAndExecute('browser-control.browser_open', {});
      expect(mockClient.openBrowser).toHaveBeenCalledOnce();
      // openBrowser 返回 void → toSDKResult('') → 空字符串
      expect(result).toBe('');
    });
  });

  describe('browser_close', () => {
    it('should call closeBrowser', async () => {
      const result = await findAndExecute('browser-control.browser_close', {});
      expect(mockClient.closeBrowser).toHaveBeenCalledOnce();
      expect(result).toBe('');
    });
  });

  describe('browser_navigate', () => {
    it('should pass url to navigate', async () => {
      const result = await findAndExecute('browser-control.browser_navigate', {
        url: 'https://example.com',
      });
      expect(mockClient.navigate).toHaveBeenCalledWith('https://example.com');
      expect(result).toBe('');
    });

    it('should throw on missing url', async () => {
      const result = await findAndExecute('browser-control.browser_navigate', {});
      // param-adapter 抛错 → execute 的 catch → toSDKError
      expect(result).toMatch(/^Error: browser_navigate: url is required/);
    });
  });

  describe('browser_screenshot', () => {
    it('should pass fullPage to screenshot', async () => {
      const result = await findAndExecute('browser-control.browser_screenshot', {
        fullPage: true,
      });
      expect(mockClient.screenshot).toHaveBeenCalledWith(true);
      // 返回 ScreenshotData → JSON.stringify
      expect(result).toContain('base64-png-data');
    });

    it('should default fullPage to false', async () => {
      await findAndExecute('browser-control.browser_screenshot', {});
      expect(mockClient.screenshot).toHaveBeenCalledWith(false);
    });
  });

  describe('browser_status', () => {
    it('should return status as JSON string', async () => {
      const result = await findAndExecute('browser-control.browser_status', {});
      expect(mockClient.getStatus).toHaveBeenCalledOnce();
      expect(result).toContain('example.com');
    });
  });

  describe('page_click', () => {
    it('should pass x and y coordinates', async () => {
      const result = await findAndExecute('browser-control.page_click', { x: 100, y: 200 });
      expect(mockClient.click).toHaveBeenCalledWith(100, 200);
      expect(result).toBe('');
    });
  });

  describe('page_click_selector', () => {
    it('should pass selector to clickBySelector', async () => {
      await findAndExecute('browser-control.page_click_selector', {
        selector: '#submit-btn',
      });
      expect(mockClient.clickBySelector).toHaveBeenCalledWith('#submit-btn');
    });

    it('should throw on missing selector', async () => {
      const result = await findAndExecute('browser-control.page_click_selector', {});
      expect(result).toMatch(/^Error: page_click_selector: selector is required/);
    });
  });

  describe('page_type', () => {
    it('should pass selector and text', async () => {
      await findAndExecute('browser-control.page_type', {
        selector: '#search',
        text: 'hello',
      });
      expect(mockClient.type).toHaveBeenCalledWith('#search', 'hello');
    });

    it('should throw on missing selector', async () => {
      const result = await findAndExecute('browser-control.page_type', {
        text: 'hello',
      });
      expect(result).toMatch(/^Error: page_type: selector is required/);
    });

    it('should throw on missing text', async () => {
      const result = await findAndExecute('browser-control.page_type', {
        selector: '#search',
      });
      expect(result).toMatch(/^Error: page_type: text is required/);
    });
  });

  describe('page_scroll', () => {
    it('should pass x and y', async () => {
      await findAndExecute('browser-control.page_scroll', { x: 0, y: 500 });
      expect(mockClient.scroll).toHaveBeenCalledWith(0, 500);
    });
  });

  describe('page_element_action', () => {
    it('should pass selector, action, param', async () => {
      await findAndExecute('browser-control.page_element_action', {
        selector: '#input',
        action: 'value',
        param: 'test-value',
      });
      expect(mockClient.elementAction).toHaveBeenCalledWith('#input', 'value', 'test-value');
    });

    it('should throw on missing selector', async () => {
      const result = await findAndExecute('browser-control.page_element_action', {
        action: 'focus',
      });
      expect(result).toMatch(/^Error: page_element_action: selector is required/);
    });
  });

  describe('dom_snapshot', () => {
    it('should call getSimplifiedDOM', async () => {
      const result = await findAndExecute('browser-control.dom_snapshot', {});
      expect(mockClient.getSimplifiedDOM).toHaveBeenCalledOnce();
      expect(result).toContain('elements');
    });
  });

  describe('dom_script', () => {
    it('should pass script and args', async () => {
      const result = await findAndExecute('browser-control.dom_script', {
        script: 'return 1 + 1',
        args: [],
      });
      expect(mockClient.executeScript).toHaveBeenCalledWith('return 1 + 1', []);
      expect(result).toContain('42');
    });

    it('should default args to empty array when not provided', async () => {
      await findAndExecute('browser-control.dom_script', {
        script: 'document.title',
      });
      expect(mockClient.executeScript).toHaveBeenCalledWith('document.title', []);
    });
  });

  describe('browser_list_tabs', () => {
    it('should return tab list', async () => {
      const result = await findAndExecute('browser-control.browser_list_tabs', {});
      expect(mockClient.getTabs).toHaveBeenCalledOnce();
      expect(result).toContain('tab-1');
    });
  });

  describe('browser_switch_tab', () => {
    it('should pass tab id', async () => {
      await findAndExecute('browser-control.browser_switch_tab', { id: 'tab-2' });
      expect(mockClient.switchTab).toHaveBeenCalledWith('tab-2');
    });
  });

  // --- execute_by_marker 分派测试 ---

  describe('execute_by_marker', () => {
    const markerBase = {
      snapshot_id: 'snap-001',
      nebula_id: 42,
    };

    it('should dispatch click via clickByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'click',
      });
      expect(mockClient.clickByMarker).toHaveBeenCalledWith('snap-001', 42);
    });

    it('should dispatch type with param via typeByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'type',
        param: 'typed text',
      });
      expect(mockClient.typeByMarker).toHaveBeenCalledWith('snap-001', 42, 'typed text');
    });

    it('should default param to empty string for type action', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'type',
      });
      expect(mockClient.typeByMarker).toHaveBeenCalledWith('snap-001', 42, '');
    });

    it('should dispatch focus via focusByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'focus',
      });
      expect(mockClient.focusByMarker).toHaveBeenCalledWith('snap-001', 42);
    });

    it('should dispatch blur via blurByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'blur',
      });
      expect(mockClient.blurByMarker).toHaveBeenCalledWith('snap-001', 42);
    });

    it('should dispatch hover via hoverByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'hover',
      });
      expect(mockClient.hoverByMarker).toHaveBeenCalledWith('snap-001', 42);
    });

    it('should dispatch value with param via setValueByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'value',
        param: 'new-value',
      });
      expect(mockClient.setValueByMarker).toHaveBeenCalledWith('snap-001', 42, 'new-value');
    });

    it('should dispatch dispatch event via dispatchEventByMarker', async () => {
      await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'dispatch',
        param: 'click',
      });
      expect(mockClient.dispatchEventByMarker).toHaveBeenCalledWith('snap-001', 42, 'click');
    });

    it('should throw on unknown marker action', async () => {
      const result = await findAndExecute('browser-control.execute_by_marker', {
        ...markerBase,
        action: 'nonexistent',
      });
      expect(result).toMatch(/^Error: Unknown marker action/);
    });

    it('should throw on missing snapshot_id', async () => {
      const result = await findAndExecute('browser-control.execute_by_marker', {
        nebula_id: 1,
        action: 'click',
      });
      expect(result).toMatch(/^Error: execute_by_marker: snapshot_id is required/);
    });

    it('should throw on missing nebula_id', async () => {
      const result = await findAndExecute('browser-control.execute_by_marker', {
        snapshot_id: 'snap-001',
        action: 'click',
      });
      expect(result).toMatch(/^Error: execute_by_marker: nebula_id is required/);
    });

    it('should throw on missing action', async () => {
      const result = await findAndExecute('browser-control.execute_by_marker', {
        snapshot_id: 'snap-001',
        nebula_id: 42,
      });
      expect(result).toMatch(/^Error: execute_by_marker: action is required/);
    });
  });

  // --- 错误处理测试 ---

  describe('error handling', () => {
    it('should return Error: prefixed string when BrowserClient throws', async () => {
      vi.mocked(mockClient.navigate).mockRejectedValueOnce(
        new Error('Playwright Server error: 500 - timeout')
      );

      const result = await findAndExecute('browser-control.browser_navigate', {
        url: 'https://fail.example.com',
      });

      expect(result).toBe('Error: Playwright Server error: 500 - timeout');
    });

    it('should handle non-Error throws gracefully', async () => {
      vi.mocked(mockClient.click).mockRejectedValueOnce('connection refused');

      const result = await findAndExecute('browser-control.page_click', { x: 1, y: 1 });

      expect(result).toBe('Error: connection refused');
    });

    it('should return Error: prefixed string when param validation fails', async () => {
      const result = await findAndExecute('browser-control.browser_navigate', {
        url: '',
      });
      // adaptNavigateParams 会拒绝空字符串
      expect(result).toMatch(/^Error: browser_navigate: url is required/);
    });

    it('should recover from error on subsequent calls', async () => {
      vi.mocked(mockClient.navigate).mockRejectedValueOnce(new Error('transient error'));

      const failResult = await findAndExecute('browser-control.browser_navigate', {
        url: 'https://fail.example.com',
      });
      expect(failResult).toMatch(/^Error: transient error/);

      // 后续调用应正常工作
      vi.mocked(mockClient.navigate).mockResolvedValueOnce(undefined);
      const okResult = await findAndExecute('browser-control.browser_navigate', {
        url: 'https://ok.example.com',
      });
      expect(okResult).toBe('');
    });
  });

  // --- 参数传递验证 ---

  describe('argument passing', () => {
    it('should pass numeric args as numbers (not strings)', async () => {
      await findAndExecute('browser-control.page_click', { x: '100', y: '200' });
      // tool-map 直接 Number(args.x)，所以字符串 '100' → 数字 100
      expect(mockClient.click).toHaveBeenCalledWith(100, 200);
    });

    it('should handle null args gracefully', async () => {
      const result = await findAndExecute('browser-control.browser_status', null);
      // (rawArgs ?? {}) as Record — null → {} → getStatus() 被调用
      expect(mockClient.getStatus).toHaveBeenCalledOnce();
      expect(result).toContain('example.com');
    });

    it('should handle undefined args gracefully', async () => {
      const result = await findAndExecute('browser-control.browser_status', undefined);
      expect(mockClient.getStatus).toHaveBeenCalledOnce();
      expect(result).toContain('example.com');
    });
  });
});
