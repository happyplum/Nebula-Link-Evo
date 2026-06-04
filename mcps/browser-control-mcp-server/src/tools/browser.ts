import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { textResult, errorResult } from '../utils.js';

export function registerBrowserTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'browser_open',
    {
      description: 'Open a new browser instance',
      inputSchema: z.object({
        headless: z.boolean().optional(),
        viewport: z.object({ width: z.number(), height: z.number() }).optional(),
        cdpPort: z.number().optional(),
      }),
      annotations: { destructiveHint: true },
    },
    async (input: {
      headless?: boolean;
      viewport?: { width: number; height: number };
      cdpPort?: number;
    }) => {
      try {
        const result = await deps.playwrightClient.openBrowser(input);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'browser_close',
    {
      description: 'Close the browser instance',
      inputSchema: z.object({}).strict(),
      annotations: { destructiveHint: true },
    },
    async () => {
      try {
        const result = await deps.playwrightClient.closeBrowser();
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'browser_navigate',
    {
      description: 'Navigate the browser to a URL',
      inputSchema: z.object({
        url: z.string().describe('URL to navigate to'),
        waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle', 'commit']).optional(),
        timeout: z.number().optional(),
      }),
    },
    async (input: { url: string; waitUntil?: string; timeout?: number }) => {
      try {
        const result = await deps.playwrightClient.navigate(
          input.url,
          input.waitUntil,
          input.timeout
        );
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'browser_screenshot',
    {
      description: 'Take a screenshot of the current page',
      inputSchema: z.object({
        fullPage: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async (input: { fullPage: boolean }) => {
      try {
        const result = await deps.playwrightClient.getScreenshot(input.fullPage);
        const screenshotData = result as { screenshot?: string };
        if (!screenshotData?.screenshot) {
          return errorResult('Failed to capture screenshot');
        }
        return {
          content: [
            {
              type: 'image' as const,
              data: screenshotData.screenshot,
              mimeType: 'image/png' as const,
            },
          ],
        };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'browser_status',
    {
      description: 'Get current browser status (open state, URL, title, viewport)',
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const result = await deps.playwrightClient.getBrowserStatus();
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
