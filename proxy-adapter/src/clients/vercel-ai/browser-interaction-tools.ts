import { tool } from 'ai';
import { z } from 'zod';
import type { BrowserClient } from '../../browser-client.js';


/** Wrap an async operation with standard ok/error response format. */
async function safeExec(fn: () => Promise<Record<string, unknown> | void>): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const result = await fn();
    return result ? { ok: true, ...result } : { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

export function createBrowserInteractionTools(client: BrowserClient): Record<string, unknown> {
  // ─── 页面快照 ────────────────────────────────────────
  const snapshotTool = tool({
    description:
      '获取当前页面快照。返回 snapshot_id（后续操作需要）、elements_map（交互元素映射，每个元素有 nebula_id）、simplified_dom（简化DOM树）。所有元素操作都需要先调用此工具获取 snapshot_id 和 nebula_id。',
    inputSchema: z.object({}).optional(),
    execute: async () => safeExec(async () => {
      const dom = await client.getSimplifiedDOM();
      // 省略 annotated_screenshot_base64 以减少 token 消耗，AI 可通过 browser_screenshot 单独获取截图
      return {
        snapshot_id: dom.snapshot_id,
        version: dom.version,
        elements_map: dom.elements_map,
        simplified_dom: dom.simplified_dom,
      };
    }),
  });

  // ─── 点击 ────────────────────────────────────────────
  const clickTool = tool({
    description: '点击页面上指定元素。需要先通过 browser_snapshot 获取 snapshot_id 和元素的 nebula_id。',
    inputSchema: z.object({
      snapshot_id: z.string().describe('最近一次 browser_snapshot 返回的 snapshot_id'),
      nebula_id: z.number().describe('要点击的元素 nebula_id（来自 elements_map）'),
    }),
    execute: async ({ snapshot_id, nebula_id }) =>
      safeExec(() => client.clickByMarker(snapshot_id, nebula_id)),
  });

  // ─── 输入文本 ────────────────────────────────────────
  const typeTool = tool({
    description: '在指定输入框中输入文本（追加模式）。需要先通过 browser_snapshot 获取 snapshot_id 和元素的 nebula_id。',
    inputSchema: z.object({
      snapshot_id: z.string().describe('最近一次 browser_snapshot 返回的 snapshot_id'),
      nebula_id: z.number().describe('目标输入框的 nebula_id（来自 elements_map）'),
      text: z.string().describe('要输入的文本内容'),
    }),
    execute: async ({ snapshot_id, nebula_id, text }) =>
      safeExec(() => client.typeByMarker(snapshot_id, nebula_id, text)),
  });

  // ─── 设置元素值（input / textarea / select 通用） ────
  const setValueTool = tool({
    description:
      '设置表单元素的值（覆盖模式，会先清空已有内容）。适用于 input、textarea、select 等表单元素。需要先通过 browser_snapshot 获取 snapshot_id 和元素的 nebula_id。',
    inputSchema: z.object({
      snapshot_id: z.string().describe('最近一次 browser_snapshot 返回的 snapshot_id'),
      nebula_id: z.number().describe('目标元素的 nebula_id（来自 elements_map）'),
      value: z.string().describe('要设置的值'),
    }),
    execute: async ({ snapshot_id, nebula_id, value }) =>
      safeExec(() => client.setValueByMarker(snapshot_id, nebula_id, value)),
  });

  // ─── 悬停 ────────────────────────────────────────────
  const hoverTool = tool({
    description: '将鼠标悬停在指定元素上。需要先通过 browser_snapshot 获取 snapshot_id 和元素的 nebula_id。',
    inputSchema: z.object({
      snapshot_id: z.string().describe('最近一次 browser_snapshot 返回的 snapshot_id'),
      nebula_id: z.number().describe('要悬停的元素 nebula_id（来自 elements_map）'),
    }),
    execute: async ({ snapshot_id, nebula_id }) =>
      safeExec(() => client.hoverByMarker(snapshot_id, nebula_id)),
  });

  // ─── 导航 ────────────────────────────────────────────
  const navigateTool = tool({
    description: '导航到指定 URL。导航后建议重新调用 browser_snapshot 获取新的页面快照。',
    inputSchema: z.object({
      url: z.string().describe('要导航到的 URL 地址'),
    }),
    execute: async ({ url }) => safeExec(() => client.navigate(url)),
  });

  // ─── 截图 ────────────────────────────────────────────
  const screenshotTool = tool({
    description: '截取当前页面截图，返回 base64 编码的 PNG 图片。',
    inputSchema: z.object({}).optional(),
    execute: async () => safeExec(async () => {
      const data = await client.screenshot();
      return { screenshot: data.screenshot };
    }),
  });

  // ─── 滚动 ────────────────────────────────────────────
  const scrollTool = tool({
    description: '滚动页面。x 为水平滚动像素（正数向右，负数向左），y 为垂直滚动像素（正数向下，负数向上）。',
    inputSchema: z.object({
      x: z.number().optional().default(0).describe('水平滚动像素（正数向右，负数向左）'),
      y: z.number().optional().default(300).describe('垂直滚动像素（正数向下，负数向上）'),
    }),
    execute: async ({ x, y }) => safeExec(() => client.scroll(x, y)),
  });

  // ─── 按键 ────────────────────────────────────────────
  const ALLOWED_KEYS = new Set([
    'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', ' ',
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Home', 'End', 'PageUp', 'PageDown',
    'Control', 'Alt', 'Shift', 'Meta',
    'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  ]);

  const pressKeyTool = tool({
    description: '模拟按下键盘按键。支持 Enter、Tab、Escape、ArrowDown 等常用按键。',
    inputSchema: z.object({
      key: z.string().describe('要按下的按键名称，如 "Enter"、"Tab"、"Escape"、"ArrowDown"'),
    }),
    execute: async ({ key }) => safeExec(async () => {
      const normalizedKey = key.length === 1 ? key : ALLOWED_KEYS.has(key) ? key : null;
      if (!normalizedKey) {
        throw new Error(`不支持的按键: "${key}"。支持的按键: Enter, Tab, Escape, Backspace, Delete, 方向键, 功能键等`);
      }
      await client.executeScript(
        `const el = document.activeElement || document.body;
         el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(normalizedKey)}, bubbles: true }));
         el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(normalizedKey)}, bubbles: true }));`
      );
    }),
  });

  // ─── 等待 ────────────────────────────────────────────
  const waitTool = tool({
    description: '等待指定时间（毫秒）。适用于等待页面加载、动画完成等场景。',
    inputSchema: z.object({
      duration: z
        .number()
        .optional()
        .default(1000)
        .describe('等待时间（毫秒），默认 1000ms'),
    }),
    execute: async ({ duration }) => {
      await new Promise((resolve) => setTimeout(resolve, duration));
      return { ok: true, waited: duration };
    },
  });

  return {
    browser_snapshot: snapshotTool,
    browser_click: clickTool,
    browser_type: typeTool,
    browser_fill_form: setValueTool,
    browser_select_option: setValueTool,
    browser_hover: hoverTool,
    browser_navigate: navigateTool,
    browser_screenshot: screenshotTool,
    browser_scroll: scrollTool,
    browser_press_key: pressKeyTool,
    browser_wait: waitTool,
  };
}
