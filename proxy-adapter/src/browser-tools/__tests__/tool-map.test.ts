import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createToolMap } from '../tool-map.js';
import { TOOL_DEFINITIONS } from '../definitions.js';
import type { BrowserClient } from '../../browser-client.js';

/**
 * 创建 BrowserClient 的 mock 实例
 * 包含 tool-map 中用到的所有方法
 */
function createMockBrowserClient(): BrowserClient {
  return {
    openBrowser: vi.fn().mockResolvedValue(undefined),
    closeBrowser: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    screenshot: vi
      .fn()
      .mockResolvedValue({ screenshot: 'base64data', mimeType: 'image/png' }),
    getSimplifiedDOM: vi
      .fn()
      .mockResolvedValue({ snapshot_id: 'test-snap', elements_map: {} }),
    click: vi.fn().mockResolvedValue(undefined),
    clickBySelector: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    scroll: vi.fn().mockResolvedValue(undefined),
    elementAction: vi.fn().mockResolvedValue(undefined),
    executeScript: vi.fn().mockResolvedValue({ result: 'ok' }),
    getStatus: vi.fn().mockResolvedValue({ isOpen: true, url: 'https://example.com' }),
    getTabs: vi.fn().mockResolvedValue([]),
    switchTab: vi.fn().mockResolvedValue(undefined),
    // marker 方法
    clickByMarker: vi.fn().mockResolvedValue(undefined),
    typeByMarker: vi.fn().mockResolvedValue(undefined),
    focusByMarker: vi.fn().mockResolvedValue(undefined),
    blurByMarker: vi.fn().mockResolvedValue(undefined),
    hoverByMarker: vi.fn().mockResolvedValue(undefined),
    setValueByMarker: vi.fn().mockResolvedValue(undefined),
    dispatchEventByMarker: vi.fn().mockResolvedValue(undefined),
    // 其他方法（不在 tool-map 中使用，但类型需要）
    focus: vi.fn().mockResolvedValue(undefined),
    blur: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    setValue: vi.fn().mockResolvedValue(undefined),
    dispatchEvent: vi.fn().mockResolvedValue(undefined),
    getCookies: vi.fn().mockResolvedValue([]),
    getLocalStorage: vi.fn().mockResolvedValue({}),
    getElementAt: vi.fn().mockResolvedValue(null),
    getPageState: vi.fn().mockResolvedValue(null),
  } as unknown as BrowserClient;
}

// ---------------------------------------------------------------------------
// createToolMap 结构
// ---------------------------------------------------------------------------
describe('createToolMap 结构', () => {
  let mockBC: BrowserClient;

  beforeEach(() => {
    mockBC = createMockBrowserClient();
  });

  it('返回 15 个工具', () => {
    const tools = createToolMap(mockBC);
    expect(Object.keys(tools)).toHaveLength(TOOL_DEFINITIONS.length);
    expect(TOOL_DEFINITIONS.length).toBe(15);
  });

  it('每个工具都有 description / parameters / execute', () => {
    const tools = createToolMap(mockBC);
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool).toHaveProperty('description');
      expect(typeof tool.description).toBe('string');
      expect(tool).toHaveProperty('parameters');
      expect(typeof tool.parameters).toBe('object');
      expect(tool).toHaveProperty('execute');
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('工具名与 TOOL_DEFINITIONS 一致', () => {
    const tools = createToolMap(mockBC);
    const defNames = TOOL_DEFINITIONS.map((d) => d.name).sort();
    const toolNames = Object.keys(tools).sort();
    expect(toolNames).toEqual(defNames);
  });
});

// ---------------------------------------------------------------------------
// execute 路由测试
// ---------------------------------------------------------------------------
describe('execute 路由到 BrowserClient 方法', () => {
  let mockBC: BrowserClient;
  let tools: ReturnType<typeof createToolMap>;

  beforeEach(() => {
    mockBC = createMockBrowserClient();
    tools = createToolMap(mockBC);
  });

  it('browser_open → openBrowser', async () => {
    await tools['browser-control.browser_open'].execute({});
    expect(mockBC.openBrowser).toHaveBeenCalledOnce();
  });

  it('browser_close → closeBrowser', async () => {
    await tools['browser-control.browser_close'].execute({});
    expect(mockBC.closeBrowser).toHaveBeenCalledOnce();
  });

  it('browser_navigate → navigate', async () => {
    const result = await tools['browser-control.browser_navigate'].execute({
      url: 'https://example.com',
    });
    expect(mockBC.navigate).toHaveBeenCalledWith('https://example.com');
    // navigate 返回 undefined → toSDKResult → ''
    expect(result).toBe('');
  });

  it('browser_navigate 缺少 url → 返回错误文本', async () => {
    const result = await tools['browser-control.browser_navigate'].execute({});
    expect(result).toContain('Error:');
    expect(result).toContain('url is required');
  });

  it('browser_screenshot → screenshot(false)', async () => {
    await tools['browser-control.browser_screenshot'].execute({ fullPage: true });
    expect(mockBC.screenshot).toHaveBeenCalledWith(true);
  });

  it('browser_status → getStatus', async () => {
    const result = await tools['browser-control.browser_status'].execute({});
    expect(mockBC.getStatus).toHaveBeenCalledOnce();
    expect(result).toContain('isOpen');
  });

  it('page_click → click', async () => {
    await tools['browser-control.page_click'].execute({ x: 100, y: 200 });
    expect(mockBC.click).toHaveBeenCalledWith(100, 200);
  });

  it('page_click_selector → clickBySelector', async () => {
    await tools['browser-control.page_click_selector'].execute({ selector: '.btn' });
    expect(mockBC.clickBySelector).toHaveBeenCalledWith('.btn');
  });

  it('page_type → type', async () => {
    await tools['browser-control.page_type'].execute({
      selector: '#input',
      text: 'hello',
    });
    expect(mockBC.type).toHaveBeenCalledWith('#input', 'hello');
  });

  it('page_scroll → scroll', async () => {
    await tools['browser-control.page_scroll'].execute({ x: 0, y: 300 });
    expect(mockBC.scroll).toHaveBeenCalledWith(0, 300);
  });

  it('page_element_action → elementAction', async () => {
    await tools['browser-control.page_element_action'].execute({
      selector: '.el',
      action: 'click',
    });
    expect(mockBC.elementAction).toHaveBeenCalledWith('.el', 'click', undefined);
  });

  it('dom_snapshot → getSimplifiedDOM', async () => {
    const result = await tools['browser-control.dom_snapshot'].execute({});
    expect(mockBC.getSimplifiedDOM).toHaveBeenCalledOnce();
    expect(result).toContain('snapshot_id');
  });

  it('dom_script → executeScript', async () => {
    await tools['browser-control.dom_script'].execute({
      script: 'return 1+1',
      args: [],
    });
    expect(mockBC.executeScript).toHaveBeenCalledWith('return 1+1', []);
  });

  it('browser_list_tabs → getTabs', async () => {
    await tools['browser-control.browser_list_tabs'].execute({});
    expect(mockBC.getTabs).toHaveBeenCalledOnce();
  });

  it('browser_switch_tab → switchTab', async () => {
    await tools['browser-control.browser_switch_tab'].execute({ id: 'tab-1' });
    expect(mockBC.switchTab).toHaveBeenCalledWith('tab-1');
  });
});

// ---------------------------------------------------------------------------
// execute_by_marker 分支测试
// ---------------------------------------------------------------------------
describe('execute_by_marker 分支路由', () => {
  let mockBC: BrowserClient;
  let tools: ReturnType<typeof createToolMap>;
  const baseArgs = { snapshot_id: 'snap-1', nebula_id: 10 };

  beforeEach(() => {
    mockBC = createMockBrowserClient();
    tools = createToolMap(mockBC);
  });

  it('click → clickByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'click',
    });
    expect(mockBC.clickByMarker).toHaveBeenCalledWith('snap-1', 10);
  });

  it('type → typeByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'type',
      param: 'hello',
    });
    expect(mockBC.typeByMarker).toHaveBeenCalledWith('snap-1', 10, 'hello');
  });

  it('type 无 param → 传空字符串', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'type',
    });
    expect(mockBC.typeByMarker).toHaveBeenCalledWith('snap-1', 10, '');
  });

  it('focus → focusByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'focus',
    });
    expect(mockBC.focusByMarker).toHaveBeenCalledWith('snap-1', 10);
  });

  it('blur → blurByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'blur',
    });
    expect(mockBC.blurByMarker).toHaveBeenCalledWith('snap-1', 10);
  });

  it('hover → hoverByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'hover',
    });
    expect(mockBC.hoverByMarker).toHaveBeenCalledWith('snap-1', 10);
  });

  it('value → setValueByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'value',
      param: 'new-value',
    });
    expect(mockBC.setValueByMarker).toHaveBeenCalledWith('snap-1', 10, 'new-value');
  });

  it('dispatch → dispatchEventByMarker', async () => {
    await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'dispatch',
      param: 'click',
    });
    expect(mockBC.dispatchEventByMarker).toHaveBeenCalledWith('snap-1', 10, 'click');
  });

  it('未知 action → 返回错误文本', async () => {
    const result = await tools['browser-control.execute_by_marker'].execute({
      ...baseArgs,
      action: 'unknown_action',
    });
    expect(result).toContain('Error:');
    expect(result).toContain('Unknown marker action');
  });
});

// ---------------------------------------------------------------------------
// 错误处理
// ---------------------------------------------------------------------------
describe('execute 错误处理', () => {
  let mockBC: BrowserClient;
  let tools: ReturnType<typeof createToolMap>;

  beforeEach(() => {
    mockBC = createMockBrowserClient();
    tools = createToolMap(mockBC);
  });

  it('BrowserClient 方法抛异常 → 返回 toSDKError 格式', async () => {
    (mockBC.openBrowser as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('connection refused'),
    );
    const result = await tools['browser-control.browser_open'].execute({});
    expect(result).toBe('Error: connection refused');
  });

  it('BrowserClient 方法抛非 Error → 返回字符串化错误', async () => {
    (mockBC.openBrowser as ReturnType<typeof vi.fn>).mockRejectedValueOnce('oops');
    const result = await tools['browser-control.browser_open'].execute({});
    expect(result).toBe('Error: oops');
  });
});
