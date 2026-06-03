import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { ToolDeps } from '../types.js';
import { textResult, errorResult } from '../utils.js';

export function registerInteractionTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'page_click',
    {
      description: 'Click at specific coordinates on the page',
      inputSchema: z.object({
        x: z.number().describe('X coordinate'),
        y: z.number().describe('Y coordinate'),
      }),
    },
    async (input: { x: number; y: number }) => {
      try {
        const result = await deps.playwrightClient.click(input.x, input.y);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'page_click_selector',
    {
      description: 'Click an element matching a CSS selector',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector'),
        options: z
          .object({
            timeout: z.number().optional(),
            delay: z.number().optional(),
            button: z.string().optional(),
            clickCount: z.number().optional(),
            modifiers: z.array(z.string()).optional(),
          })
          .optional(),
      }),
    },
    async (input: {
      selector: string;
      options?: {
        timeout?: number;
        delay?: number;
        button?: string;
        clickCount?: number;
        modifiers?: string[];
      };
    }) => {
      try {
        const result = await deps.playwrightClient.clickBySelector(input.selector, input.options);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'page_type',
    {
      description: 'Type text into an element matching a CSS selector',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector'),
        text: z.string().describe('Text to type'),
        options: z
          .object({
            delay: z.number().optional(),
            clear: z.boolean().optional(),
          })
          .optional(),
      }),
    },
    async (input: {
      selector: string;
      text: string;
      options?: { delay?: number; clear?: boolean };
    }) => {
      try {
        const result = await deps.playwrightClient.typeText(
          input.selector,
          input.text,
          input.options
        );
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'page_scroll',
    {
      description: 'Scroll the page by specified amounts',
      inputSchema: z.object({
        x: z.number().describe('Horizontal scroll amount'),
        y: z.number().describe('Vertical scroll amount'),
      }),
    },
    async (input: { x: number; y: number }) => {
      try {
        const result = await deps.playwrightClient.scroll(input.x, input.y);
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );

  server.registerTool(
    'page_element_action',
    {
      description: 'Perform an action on an element (focus, blur, hover, value, dispatch)',
      inputSchema: z.object({
        selector: z.string().describe('CSS selector'),
        action: z
          .enum(['focus', 'blur', 'hover', 'value', 'dispatch'])
          .describe('Action to perform'),
        param: z
          .string()
          .optional()
          .describe(
            'Parameter for the action (e.g., value for value action, eventType for dispatch)'
          ),
      }),
    },
    async (input: {
      selector: string;
      action: 'focus' | 'blur' | 'hover' | 'value' | 'dispatch';
      param?: string;
    }) => {
      try {
        const result = await deps.playwrightClient.elementAction(
          input.selector,
          input.action,
          input.param
        );
        return textResult(JSON.stringify(result));
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    }
  );
}
