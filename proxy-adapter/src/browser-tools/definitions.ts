/**
 * 15 个浏览器工具的 JSON Schema 定义
 *
 * 与 MCP server 的 Zod schema 对齐，使用纯 JSON Schema 对象字面量。
 * 工具名使用 browser-control.* 前缀以区分来源。
 */

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: 'object';
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'browser-control.browser_open',
    description: 'Open a new browser instance',
    inputSchema: {
      type: 'object',
      properties: {
        headless: { type: 'boolean', description: 'Run browser in headless mode' },
        viewport: {
          type: 'object',
          properties: {
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Viewport dimensions',
        },
        cdpPort: { type: 'number', description: 'CDP debug port' },
      },
    },
  },
  {
    name: 'browser-control.browser_close',
    description: 'Close the browser instance',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser-control.browser_navigate',
    description: 'Navigate the browser to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
          description: 'When to consider navigation complete',
        },
        timeout: { type: 'number', description: 'Navigation timeout in ms' },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser-control.browser_screenshot',
    description: 'Take a screenshot of the current page',
    inputSchema: {
      type: 'object',
      properties: {
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page',
          default: false,
        },
      },
    },
  },
  {
    name: 'browser-control.browser_status',
    description: 'Get current browser status (open state, URL, title, viewport)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser-control.page_click',
    description: 'Click at specific coordinates on the page',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X coordinate' },
        y: { type: 'number', description: 'Y coordinate' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser-control.page_click_selector',
    description: 'Click an element matching a CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        options: {
          type: 'object',
          properties: {
            timeout: { type: 'number' },
            delay: { type: 'number' },
            button: { type: 'string' },
            clickCount: { type: 'number' },
            modifiers: { type: 'array', items: { type: 'string' } },
          },
          description: 'Click options',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser-control.page_type',
    description: 'Type text into an element matching a CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        text: { type: 'string', description: 'Text to type' },
        options: {
          type: 'object',
          properties: {
            delay: { type: 'number' },
            clear: { type: 'boolean' },
          },
          description: 'Typing options',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser-control.page_scroll',
    description: 'Scroll the page by specified amounts',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'Horizontal scroll amount' },
        y: { type: 'number', description: 'Vertical scroll amount' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'browser-control.page_element_action',
    description: 'Perform an action on an element (focus, blur, hover, value, dispatch)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector' },
        action: {
          type: 'string',
          enum: ['focus', 'blur', 'hover', 'value', 'dispatch'],
          description: 'Action to perform',
        },
        param: {
          type: 'string',
          description: 'Parameter for the action (e.g., value for value action, eventType for dispatch)',
        },
      },
      required: ['selector', 'action'],
    },
  },
  {
    name: 'browser-control.dom_snapshot',
    description: 'Get a simplified DOM snapshot of the current page with interactive elements and their bounding boxes',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser-control.dom_script',
    description: 'Execute arbitrary JavaScript in the browser page context',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
        args: {
          type: 'array',
          items: {},
          description: 'Arguments to pass to the script function',
        },
      },
      required: ['script'],
    },
  },
  {
    name: 'browser-control.execute_by_marker',
    description: 'Execute an action on a DOM element identified by snapshot_id and nebula_id (from a previous dom_snapshot)',
    inputSchema: {
      type: 'object',
      properties: {
        snapshot_id: { type: 'string', description: 'Snapshot ID from a previous dom_snapshot call' },
        nebula_id: { type: 'number', description: 'Element nebula_id from the snapshot' },
        action: {
          type: 'string',
          enum: ['click', 'type', 'focus', 'blur', 'hover', 'value', 'dispatch'],
          description: 'Action to perform on the element',
        },
        param: {
          type: 'string',
          description: 'Parameter for the action (e.g., text for type action)',
        },
      },
      required: ['snapshot_id', 'nebula_id', 'action'],
    },
  },
  {
    name: 'browser-control.browser_list_tabs',
    description: 'List all open browser tabs',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'browser-control.browser_switch_tab',
    description: 'Switch to a specific browser tab by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Tab ID to switch to' },
      },
      required: ['id'],
    },
  },
] as const;
