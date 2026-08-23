import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { browserClient } from '../../../browser-client.js';
import { screencastManager } from '../../../browser-engine/screencast.js';
import { BrowserService } from '../../../browser-engine/services/browser-service.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppService } from '../../../services/index.js';
import { DebugDatabaseManager } from '../../../debug-db.js';
import debugStreamRoutes from './stream.js';
import { debugEventHub } from '../../../services/debug-event-hub.js';
import type { BrowserExecutionService } from '../../../browser-execution/service.js';

interface InteractionQuery {
  limit?: number;
  offset?: number;
  action_type?: string;
  success?: boolean;
  locator_strategy?: string;
  start_time?: number;
}

interface DebugRoutesOptions {
  browserExecutionService?: BrowserExecutionService;
}

const CONTROLLED_SESSION_BLOCKED_ROUTES = new Set([
  'POST /api/playwright/open',
  'POST /api/playwright/close',
  'POST /api/playwright/tabs/switch',
  'POST /api/playwright/navigate',
  'GET /api/playwright/screenshot',
  'GET /api/dom',
  'GET /api/playwright/element-at',
  'POST /api/playwright/click-by-selector',
  'POST /api/playwright/click',
  'POST /api/playwright/execute-script',
  'GET /api/playwright/cookies',
  'GET /api/playwright/local-storage',
  'POST /api/playwright/type',
  'POST /api/playwright/action',
  'POST /api/playwright/click-by-marker',
  'POST /api/playwright/execute-by-marker',
  'POST /api/playwright/scroll',
  'POST /api/mcp/call',
]);

const debugRoutes: FastifyPluginAsyncTypebox<DebugRoutesOptions> = async (fastify, options) => {
  const appService = AppService.getInstance();

  fastify.addHook('preHandler', async (request, reply) => {
    const routePath = (request.routeOptions.url ?? request.url.split('?')[0]).replace(
      /^\/debug/,
      ''
    );
    const routeKey = `${request.method} ${routePath}`;
    if (
      options.browserExecutionService?.hasActiveSession() &&
      CONTROLLED_SESSION_BLOCKED_ROUTES.has(routeKey)
    ) {
      return reply.code(409).send({
        success: false,
        code: 'browser_busy',
        error: '受控浏览器会话活动期间，兼容调试写入和直接页面采集已禁用',
      });
    }
  });

  await fastify.register(debugStreamRoutes, { prefix: '/api' });

  fastify.get(
    '/api/health',
    {
      schema: {
        description: 'Get detailed health status of all services',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              services: {
                type: 'object',
                properties: {
                  playwright: {
                    type: 'object',
                    properties: {
                      isOpen: { type: 'boolean' },
                      url: { type: 'string' },
                      title: { type: 'string' },
                      status: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const playwright = await browserClient.getStatus();
      return {
        services: {
          playwright: {
            isOpen: playwright.isOpen,
            url: playwright.url,
            title: playwright.title,
            status: playwright.isOpen ? 'healthy' : 'unhealthy',
          },
        },
      };
    }
  );

  fastify.post(
    '/api/playwright/open',
    {
      schema: {
        description: 'Open browser instance',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async () => {
      try {
        await browserClient.openBrowser();
        return { success: true, message: '浏览器已打开' };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/close',
    {
      schema: {
        description: 'Close browser instance',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async () => {
      try {
        await browserClient.closeBrowser();
        return { success: true, message: '浏览器已关闭' };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/playwright/status',
    {
      schema: {
        description: 'Get browser status',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              isOpen: { type: 'boolean' },
              url: { type: 'string' },
              title: { type: 'string' },
            },
          },
        },
      },
    },
    async () => {
      try {
        const status = await browserClient.getStatus();
        return { success: true, ...status };
      } catch (error) {
        return { success: false, error: (error as Error).message, isOpen: false };
      }
    }
  );

  fastify.get(
    '/api/playwright/tabs',
    {
      schema: {
        description: 'Get browser open tabs',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              tabs: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    url: { type: 'string' },
                    title: { type: 'string' },
                    isActive: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      try {
        const tabs = await browserClient.getTabs();
        return { success: true, tabs };
      } catch (error) {
        return { success: false, tabs: [], error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/tabs/switch',
    {
      schema: {
        description: 'Switch to a specific browser tab',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
          required: ['id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { id } = request.body as { id: string };
      try {
        await browserClient.switchTab(id);
        return { success: true, message: `已切换到标签页` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/navigate',
    {
      schema: {
        description: 'Navigate browser to URL',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { url } = request.body as { url: string };
      try {
        await browserClient.navigate(url);
        return { success: true, message: `已导航到 ${url}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/playwright/screenshot/stream',
    {
      schema: {
        description: 'Browser live MJPEG stream from in-process screencast engine',
        tags: ['Debug'],
      },
    },
    async (request, reply) => {
      // Serve MJPEG directly from the in-process screencast engine (migrated from playwright-server proxy)
      if (!screencastManager.isActive()) {
        try {
          await BrowserService.getInstance().withPage('debug-stream-recovery', async (page) => {
            if (!screencastManager.isActive()) {
              await screencastManager.start(page);
            }
          });
        } catch {
          // Preserve the existing 502 response when no usable browser page exists.
        }
      }

      if (!screencastManager.isActive()) {
        reply.status(502);
        return { success: false, error: 'LiveView stream unavailable' };
      }

      const VIDEO_DEBUG = process.env.LOG_LEVEL === 'debug';
      screencastManager.setDebugEnabled(VIDEO_DEBUG);

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      screencastManager.addListener(reply.raw);

      return new Promise<void>((resolve) => {
        request.raw.on('close', () => {
          screencastManager.removeListener(reply.raw);
          resolve();
        });
      });
    }
  );

  fastify.get(
    '/api/playwright/screenshot',
    {
      schema: {
        description: 'Capture browser screenshot',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              screenshot: { type: 'string' },
              viewport: {
                type: 'object',
                properties: {
                  width: { type: 'number' },
                  height: { type: 'number' },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      try {
        const screenshotData = await browserClient.screenshot();
        return {
          success: true,
          screenshot: screenshotData.screenshot,
          viewport: screenshotData.viewport,
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/dom',
    {
      schema: {
        description: 'Get simplified DOM tree with vision markers',
        tags: ['Debug'],
      },
    },
    async (request, _reply) => {
      try {
        request.log.info('[Debug API] Fetching DOM from browserClient...');
        const dom = await browserClient.getSimplifiedDOM();
        request.log.info(
          {
            hasSnapshotId: !!dom.snapshot_id,
            hasAnnotatedScreenshot: !!dom.annotated_screenshot_base64,
            elementsMapLength: dom.elements_map?.length,
            hasSimplifiedDom: !!dom.simplified_dom,
            version: dom.version,
          },
          '[Debug API] DOM data received'
        );

        return {
          success: true,
          dom,
        };
      } catch (error) {
        request.log.error({ err: error }, '[Debug API] Error fetching DOM');
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get<{ Querystring: { x: number; y: number } }>(
    '/api/playwright/element-at',
    {
      schema: {
        description: 'Get element information at specified coordinates',
        tags: ['Debug'],
        querystring: {
          type: 'object',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
          },
          required: ['x', 'y'],
        },
      },
    },
    async (request, _reply) => {
      const { x, y } = request.query;
      try {
        const element = await browserClient.getElementAt(x, y);
        if (!element) {
          return { success: false, error: '未找到元素' };
        }
        return { success: true, element };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/click-by-selector',
    {
      schema: {
        description: 'Click element by selector',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            selector: { type: 'string' },
          },
          required: ['selector'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { selector } = request.body as { selector: string };
      try {
        await browserClient.clickBySelector(selector);
        return { success: true, message: `已点击元素 ${selector}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/click',
    {
      schema: {
        description: 'Click at coordinates',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { x, y } = request.body as { x: number; y: number };
      try {
        await browserClient.click(x, y);
        return { success: true, message: `已点击坐标 (${x}, ${y})` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/execute-script',
    {
      schema: {
        description: 'Execute script in browser context',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            script: { type: 'string' },
            args: {
              type: 'array',
              items: {},
            },
          },
          required: ['script'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              result: {},
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { script, args } = request.body as { script: string; args?: unknown[] };
      try {
        const result = await browserClient.executeScript(script, args);
        return { success: true, result };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/playwright/cookies',
    {
      schema: {
        description: 'Get document cookies from current page',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              cookies: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    value: { type: 'string' },
                    domain: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      try {
        const cookies = await browserClient.getCookies();
        return { success: true, cookies };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/playwright/local-storage',
    {
      schema: {
        description: 'Get localStorage data from current page',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              data: {
                type: 'object',
                additionalProperties: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async () => {
      try {
        const data = await browserClient.getLocalStorage();
        return { success: true, data };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/type',
    {
      schema: {
        description: 'Type text into element',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { selector, text } = request.body as { selector: string; text: string };
      try {
        await browserClient.type(selector, text);
        return { success: true, message: `已在 ${selector} 输入文本` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/api/playwright/action',
    {
      schema: {
        description: 'Execute element action (click, type, value, focus, blur, hover, dispatch)',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { selector, action, param } = request.body as {
        selector: string;
        action: string;
        param?: string;
      };
      const actionNames: Record<string, string> = {
        click: '点击',
        type: '输入文本',
        value: '设置值',
        focus: '聚焦',
        blur: '失焦',
        hover: '悬停',
        dispatch: '派发事件',
      };
      try {
        await browserClient.elementAction(selector, action, param);
        return { success: true, message: `已对 ${selector} 执行 ${actionNames[action] || action}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/click-by-marker',
    {
      schema: {
        description: 'Click element by marker ID',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            snapshot_id: { type: 'string' },
            nebula_id: { type: 'number' },
          },
          required: ['snapshot_id', 'nebula_id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { snapshot_id, nebula_id } = request.body as { snapshot_id: string; nebula_id: number };
      try {
        await browserClient.clickByMarker(snapshot_id, nebula_id);
        return { success: true, message: `已点击元素 #${nebula_id}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );
  fastify.post(
    '/api/playwright/execute-by-marker',
    {
      schema: {
        description: 'Execute action by marker ID',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            snapshot_id: { type: 'string' },
            nebula_id: { type: 'number' },
            action: { type: 'string' },
            param: { type: 'string' },
          },
          required: ['snapshot_id', 'nebula_id', 'action'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { snapshot_id, nebula_id, action, param } = request.body as {
        snapshot_id: string;
        nebula_id: number;
        action: string;
        param?: string;
      };
      const actionNames: Record<string, string> = {
        click: '点击',
        type: '输入文本',
        focus: '聚焦',
        blur: '失焦',
        hover: '悬停',
        value: '设置值',
        dispatch: '派发事件',
      };
      try {
        switch (action) {
          case 'click':
            await browserClient.clickByMarker(snapshot_id, nebula_id);
            break;
          case 'type':
            await browserClient.typeByMarker(snapshot_id, nebula_id, param!);
            break;
          case 'focus':
            await browserClient.focusByMarker(snapshot_id, nebula_id);
            break;
          case 'blur':
            await browserClient.blurByMarker(snapshot_id, nebula_id);
            break;
          case 'hover':
            await browserClient.hoverByMarker(snapshot_id, nebula_id);
            break;
          case 'value':
            await browserClient.setValueByMarker(snapshot_id, nebula_id, param!);
            break;
          case 'dispatch':
            await browserClient.dispatchEventByMarker(snapshot_id, nebula_id, param!);
            break;
          default:
            return { success: false, error: `未知操作: ${action}` };
        }
        return { success: true, message: `已${actionNames[action] || action}元素 #${nebula_id}` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.post(
    '/api/playwright/scroll',
    {
      schema: {
        description: 'Scroll page',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const { x, y } = request.body as { x: number; y: number };
      try {
        await browserClient.scroll(x, y);
        return { success: true, message: `已滚动页面 (${x}, ${y})` };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/mcp/status',
    {
      schema: {
        description: 'Get MCP servers status (built-in providers and external servers)',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              enabled: { type: 'boolean' },
              servers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    running: { type: 'boolean' },
                    state: { type: 'string' },
                    toolsCount: { type: 'number' },
                    source: { type: 'string', enum: ['built-in', 'external'] },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return appService.getMCPStatus();
    }
  );

  fastify.get(
    '/api/mcp/tools',
    {
      schema: {
        description: 'Get available MCP tools (built-in and external)',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              tools: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    inputSchema: { type: 'object' },
                    source: { type: 'string', enum: ['built-in', 'external'] },
                    annotations: {
                      type: 'object',
                      properties: {
                        title: { type: 'string' },
                        readOnlyHint: { type: 'boolean' },
                        destructiveHint: { type: 'boolean' },
                        idempotentHint: { type: 'boolean' },
                        openWorldHint: { type: 'boolean' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const tools = appService.getMCPTools();
      return { tools };
    }
  );

  fastify.post(
    '/api/mcp/call',
    {
      schema: {
        description: 'Call an MCP tool',
        tags: ['Debug'],
        body: {
          type: 'object',
          properties: {
            server: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object' },
          },
          required: ['server', 'tool'],
        },
      },
    },
    async (request, _reply) => {
      const {
        server,
        tool,
        args = {},
      } = request.body as { server: string; tool: string; args?: Record<string, unknown> };
      try {
        const toolRegistry = appService.getToolRegistry();
        if (!toolRegistry) {
          return { success: false, error: 'MCP gateway tools are not initialized' };
        }

        const toolName = tool.includes('.') ? tool : `${server}.${tool}`;
        const gatewayTool = toolRegistry
          .getAvailableTools({ consumer: 'mcp-server' })
          .find((candidate) => candidate.name === toolName);

        if (!gatewayTool) {
          return { success: false, error: `MCP gateway tool not found: ${toolName}` };
        }
        const result = await gatewayTool.execute(args);

        try {
          debugEventHub.publish({
            type: 'debug.mcp_invalidated',
            scope: 'all',
            reason: 'tool_call',
            emittedAt: new Date().toISOString(),
          });
        } catch {
          // Best-effort only: MCP response must not fail if debug fan-out throws.
        }

        return { success: true, result };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  );

  fastify.get(
    '/api/interactions',
    {
      schema: {
        description: 'Get interaction history',
        tags: ['Debug'],
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number' },
            offset: { type: 'number' },
            action_type: { type: 'string' },
            success: { type: 'boolean' },
            locator_strategy: { type: 'string' },
            start_time: { type: 'number' },
          },
        },
      },
    },
    async (request, _reply) => {
      const query = request.query as InteractionQuery;
      const options = {
        limit: query.limit ? Number(query.limit) : 100,
        offset: query.offset ? Number(query.offset) : 0,
        action_type: query.action_type,
        success: query.success !== undefined ? String(query.success) === 'true' : undefined,
        locator_strategy: query.locator_strategy,
        start_time: query.start_time ? Number(query.start_time) : undefined,
      };
      const db = DebugDatabaseManager.getInstance();
      const interactions = db.queryInteractions(options);
      return { success: true, data: interactions };
    }
  );

  fastify.get(
    '/api/interactions/stats',
    {
      schema: {
        description: 'Get interaction statistics',
        tags: ['Debug'],
      },
    },
    async (_request, _reply) => {
      const db = DebugDatabaseManager.getInstance();
      const stats = db.getStats();
      return { success: true, data: stats };
    }
  );

  fastify.get<{ Querystring: { path: string } }>(
    '/api/failure-sample',
    {
      schema: {
        description: 'Get failure sample data',
        tags: ['Debug'],
        querystring: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
        },
      },
    },
    async (request, _reply) => {
      const { path } = request.query;
      try {
        if (!path || !existsSync(path)) {
          return { success: false, error: '失败样本路径不存在' };
        }

        const screenshotPath = join(path, 'screenshot.png');
        const domPath = join(path, 'dom.json');
        const contextPath = join(path, 'context.json');

        let screenshot = '';
        let dom = null;
        let context = null;

        if (existsSync(screenshotPath)) {
          const screenshotBuffer = readFileSync(screenshotPath);
          screenshot = screenshotBuffer.toString('base64');
        }

        if (existsSync(domPath)) {
          const domContent = readFileSync(domPath, 'utf-8');
          dom = JSON.parse(domContent);
        }

        if (existsSync(contextPath)) {
          const contextContent = readFileSync(contextPath, 'utf-8');
          context = JSON.parse(contextContent);
        }

        return {
          success: true,
          data: {
            path,
            screenshot,
            dom,
            context,
          },
        };
      } catch (error) {
        request.log.error({ err: error }, '[Debug API] Error reading failure sample');
        return { success: false, error: (error as Error).message };
      }
    }
  );
};

export default debugRoutes;
