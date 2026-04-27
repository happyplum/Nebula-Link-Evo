import { tool } from 'ai';
import type { ToolExecutionOptions } from 'ai';
import { z } from 'zod';
import type { ActionExecutor, ActionResult } from '../../services/action-executor.js';


export function createCoreTools(executor: ActionExecutor) {
  const clickTool = tool({
    description: 'Click element by selector or coordinates',
    inputSchema: z.object({
      selector: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
    }).refine((v) => v.selector || (v.x !== undefined && v.y !== undefined)),
    execute: async ({ selector, x, y }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({ 
        type: 'click', 
        params: { selector, x, y } 
      });
    },
  });

  const typeTool = tool({
    description: 'Type text into an input field',
    inputSchema: z.object({
      selector: z.string(),
      text: z.string(),
      clear: z.boolean().optional().default(true),
    }),
    execute: async ({ selector, text, clear }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({
        type: 'type',
        params: { selector, text, clear },
      });
    },
  });

  const navigateTool = tool({
    description: 'Navigate to a URL',
    inputSchema: z.object({
      url: z.string().url(),
    }),
    execute: async ({ url }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({
        type: 'navigate',
        params: { url },
      });
    },
  });

  const scrollTool = tool({
    description: 'Scroll the page',
    inputSchema: z.object({
      x: z.number().default(0),
      y: z.number().default(0),
    }),
    execute: async ({ x, y }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({
        type: 'scroll',
        params: { x, y },
      });
    },
  });

  const waitTool = tool({
    description: 'Wait for a specified duration',
    inputSchema: z.object({
      duration: z.number().default(1000).describe('Duration in milliseconds'),
    }),
    execute: async ({ duration }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({
        type: 'wait',
        params: { duration },
      });
    },
  });

  const screenshotTool = tool({
    description: 'Take a screenshot of the current page',
    inputSchema: z.object({
      fullPage: z.boolean().optional().default(false),
    }),
    execute: async ({ fullPage }, _options: ToolExecutionOptions): Promise<ActionResult> => {
      return await executor.execute({
        type: 'screenshot',
        params: { fullPage },
      });
    },
  });

  return {
    click: clickTool,
    type: typeTool,
    navigate: navigateTool,
    scroll: scrollTool,
    wait: waitTool,
    screenshot: screenshotTool,
  };
}