import type { BrowserClient } from '../browser-client.js';
import type { SDKTool } from './types.js';
import { toSDKResult, toSDKError } from './result-adapter.js';
import {
  adaptNavigateParams,
  adaptScreenshotParams,
  adaptTypeParams,
  adaptClickSelectorParams,
  adaptElementActionParams,
  adaptMarkerParams,
} from './param-adapter.js';
import { TOOL_DEFINITIONS } from './definitions.js';

/**
 * 创建工具名 → SDKTool 的映射
 *
 * 每个 execute 函数捕获 BrowserClient 实例，
 * 通过 executeTool 统一分派到对应的 BrowserClient 方法。
 */
export function createToolMap(browserClient: BrowserClient): Record<string, SDKTool> {
  const tools: Record<string, SDKTool> = {};

  for (const def of TOOL_DEFINITIONS) {
    const name = def.name;
    tools[name] = {
      description: def.description,
      parameters: def.inputSchema as Record<string, unknown>,
      execute: async (rawArgs: unknown): Promise<string> => {
        const args = (rawArgs ?? {}) as Record<string, unknown>;
        try {
          const result = await executeTool(name, browserClient, args);
          return toSDKResult(result);
        } catch (error) {
          return toSDKError(error);
        }
      },
    };
  }

  return tools;
}

async function executeTool(
  name: string,
  bc: BrowserClient,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'browser-control.browser_open': {
      return bc.openBrowser();
    }
    case 'browser-control.browser_close': {
      return bc.closeBrowser();
    }
    case 'browser-control.browser_navigate': {
      const p = adaptNavigateParams(args);
      return bc.navigate(p.url);
    }
    case 'browser-control.browser_screenshot': {
      adaptScreenshotParams(args);
      return bc.screenshot();
    }
    case 'browser-control.browser_status': {
      return bc.getStatus();
    }
    case 'browser-control.page_click': {
      return bc.click(Number(args.x), Number(args.y));
    }
    case 'browser-control.page_click_selector': {
      const p = adaptClickSelectorParams(args);
      return bc.clickBySelector(p.selector);
    }
    case 'browser-control.page_type': {
      const p = adaptTypeParams(args);
      return bc.type(p.selector, p.text);
    }
    case 'browser-control.page_scroll': {
      return bc.scroll(Number(args.x), Number(args.y));
    }
    case 'browser-control.page_element_action': {
      const p = adaptElementActionParams(args);
      return bc.elementAction(p.selector, p.action, p.param);
    }
    case 'browser-control.dom_snapshot': {
      return bc.getSimplifiedDOM();
    }
    case 'browser-control.dom_script': {
      return bc.executeScript(
        String(args.script),
        Array.isArray(args.args) ? args.args as unknown[] : [],
      );
    }
    case 'browser-control.execute_by_marker': {
      const p = adaptMarkerParams(args);
      return dispatchByMarker(bc, p.snapshotId, p.nebulaId, p.action, p.param);
    }
    case 'browser-control.browser_list_tabs': {
      return bc.getTabs();
    }
    case 'browser-control.browser_switch_tab': {
      return bc.switchTab(String(args.id));
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * BrowserClient 没有 executeByMarker() 统一方法，
 * 按 action 分派到具体的 marker 方法。
 */
function dispatchByMarker(
  bc: BrowserClient,
  snapshotId: string,
  nebulaId: number,
  action: string,
  param?: string,
): Promise<void> {
  switch (action) {
    case 'click':
      return bc.clickByMarker(snapshotId, nebulaId);
    case 'type':
      return bc.typeByMarker(snapshotId, nebulaId, param ?? '');
    case 'focus':
      return bc.focusByMarker(snapshotId, nebulaId);
    case 'blur':
      return bc.blurByMarker(snapshotId, nebulaId);
    case 'hover':
      return bc.hoverByMarker(snapshotId, nebulaId);
    case 'value':
      return bc.setValueByMarker(snapshotId, nebulaId, param ?? '');
    case 'dispatch':
      return bc.dispatchEventByMarker(snapshotId, nebulaId, param ?? '');
    default:
      throw new Error(`Unknown marker action: ${action}`);
  }
}
