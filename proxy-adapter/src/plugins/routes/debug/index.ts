import { once } from 'node:events';
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { browserClient } from '../../../browser-client.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { TaskService } from '../../../services/index.js';
import { DatabaseManager } from '../../../conversation/db.js';
import { getServiceEndpointsCached } from '../../../config/services.js';

const PLAYWRIGHT_URL = getServiceEndpointsCached().playwright.url;
const debugRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  const taskService = TaskService.getInstance();
  const wsManager = (fastify as any).wsManager;

  fastify.get('/ws', { websocket: true }, (connection, _req) => {
    const clientId = crypto.randomUUID();
    wsManager.handleConnection(connection, clientId);
    // DEPRECATION WARNING: /debug/ws is deprecated, use /ws/debug instead
    console.log(
      `[DEPRECATED] Legacy WebSocket client connected: ${clientId} (Total: ${wsManager.getClientCount()}). Use /ws/debug instead.`
    );
    console.log(`WebSocket client connected: ${clientId} (Total: ${wsManager.getClientCount()})`);
  });

  fastify.get(
    '/api/tasks',
    {
      schema: {
        description: 'Get task execution history',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    taskId: { type: 'string' },
                    url: { type: 'string' },
                    instruction: { type: 'string' },
                    startTime: { type: 'string' },
                    endTime: { type: 'string' },
                    status: { type: 'string' },
                    stepCount: { type: 'number' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (_request, _reply) => {
      const query = _request.query as { limit?: string };
      const limit = query.limit ? parseInt(query.limit) : undefined;
      const tasks = taskService.getHistory(limit);
      return { tasks };
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/tasks/:id',
    {
      schema: {
        description: 'Get specific task by ID',
        tags: ['Debug'],
        params: {
          type: 'object',
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              taskId: { type: 'string' },
              url: { type: 'string' },
              instruction: { type: 'string' },
              startTime: { type: 'string' },
              endTime: { type: 'string' },
              status: { type: 'string' },
              stepCount: { type: 'number' },
              steps: { type: 'array', items: { type: 'object' } },
              result: { type: 'string' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, _reply) => {
      const task = taskService.getHistoryById(request.params.id);
      if (!task) {
        _reply.status(404);
        return { error: 'Task not found' };
      }
      return task;
    }
  );

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
    '/api/test-ai',
    {
      schema: {
        description: 'Test AI provider connectivity',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              vision: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  responseTime: { type: 'number' },
                  error: { type: 'string' },
                  intro: { type: 'string' },
                },
              },
              decision: {
                type: 'object',
                properties: {
                  status: { type: 'string' },
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  responseTime: { type: 'number' },
                  error: { type: 'string' },
                  intro: { type: 'string' },
                },
              },
              totalResponseTime: { type: 'number' },
            },
          },
        },
      },
    },
    async () => {
      return await taskService.testAIConnectivity();
    }
  );

  fastify.get(
    '/api/verify-keys',
    {
      schema: {
        description: 'Verify API key configuration status',
        tags: ['Debug'],
        response: {
          200: {
            type: 'object',
            properties: {
              keys: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    provider: { type: 'string' },
                    displayName: { type: 'string' },
                    status: { type: 'string' },
                    keyPreview: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const config = taskService.getConfig();
      if (!config?._resolved?.providers) {
        return { keys: [] };
      }

      const results = [];

      for (const [providerName, providerConfig] of Object.entries(config._resolved.providers)) {
        const providerConf = providerConfig as any;
        if (!providerConf.enabled) continue;

        const apiKey = providerConf.apiKey;
        const providerDisplayName = providerConf.name;

        if (!apiKey || apiKey === '' || apiKey.startsWith('{')) {
          results.push({
            provider: providerName,
            displayName: providerDisplayName,
            status: 'not_set',
            keyPreview: 'N/A',
          });
          continue;
        }

        const keyPreview =
          apiKey.length > 12 ? `${apiKey.slice(0, 8)}****${apiKey.slice(-4)}` : '****';

        results.push({
          provider: providerName,
          displayName: providerDisplayName,
          status: 'valid',
          keyPreview,
        });
      }

      return { keys: results };
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
        description: 'Proxy browser live stream',
        tags: ['Debug'],
      },
    },
    async (request, reply) => {
      const abortController = new AbortController();
      request.raw.on('close', () => abortController.abort());

      const upstream = await fetch(`${PLAYWRIGHT_URL}/browser/stream`, {
        signal: abortController.signal,
      });

      if (!upstream.ok || !upstream.body) {
        reply.status(502);
        return { success: false, error: 'LiveView stream unavailable' };
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type':
          upstream.headers.get('content-type') ?? 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value) {
            if (!reply.raw.write(value)) {
              await once(reply.raw, 'drain');
            }
          }
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === 'AbortError')) {
          request.log.error({ err: error }, 'Failed to proxy screenshot stream');
        }
      } finally {
        reader.releaseLock();
        reply.raw.end();
      }
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

  fastify.get<{ Querystring: { version?: string } }>(
    '/api/dom',
    {
      schema: {
        description: 'Get simplified DOM tree with vision markers',
        tags: ['Debug'],
        querystring: {
          type: 'object',
          properties: {
            version: { type: 'string', description: 'API version (e.g., "1.0", "2.0")' },
          },
        },
      },
    },
    async (request, _reply) => {
      try {
        const { version } = request.query;
        console.log('[Debug API] Fetching DOM from browserClient...');
        const dom = await browserClient.getSimplifiedDOM();
        console.log(
          '[Debug API] DOM data received:',
          JSON.stringify({
            hasSnapshotId: !!dom.snapshot_id,
            hasAnnotatedScreenshot: !!dom.annotated_screenshot_base64,
            elementsMapLength: dom.elements_map?.length,
            hasSimplifiedDom: !!dom.simplified_dom,
            version: dom.version,
          })
        );

        return {
          success: true,
          dom,
        };
      } catch (error) {
        console.error('[Debug API] Error fetching DOM:', error);
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
        description: 'Get MCP servers status',
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
                    toolsCount: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      return taskService.getMCPStatus();
    }
  );

  fastify.get(
    '/api/mcp/tools',
    {
      schema: {
        description: 'Get available MCP tools',
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
                  },
                },
              },
            },
          },
        },
      },
    },
    async () => {
      const tools = taskService.getMCPTools();
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
      } = request.body as { server: string; tool: string; args?: Record<string, any> };
      try {
        const mcpClient = taskService.getMCPSDKClient();
        if (!mcpClient) {
          return { success: false, error: 'MCP client not initialized' };
        }
        const result = await mcpClient.callTool(server, tool, args);
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
      const query = request.query as any;
      const options = {
        limit: query.limit ? Number(query.limit) : 100,
        offset: query.offset ? Number(query.offset) : 0,
        action_type: query.action_type,
        success: query.success !== undefined ? String(query.success) === 'true' : undefined,
        locator_strategy: query.locator_strategy,
        start_time: query.start_time ? Number(query.start_time) : undefined,
      };
      const db = DatabaseManager.getInstance();
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
      const db = DatabaseManager.getInstance();
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
        console.error('[Debug API] Error reading failure sample:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
};

export default debugRoutes;
