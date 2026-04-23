import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { TaskRequest } from '../../config/schema.js';
import { TaskRequestSchema, TaskResponseSchema } from '../../schemas/task.js';

import { TaskService } from '../../services/index.js';
const taskRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  fastify.post<{ Body: TaskRequest }>(
    '/',
    {
      schema: {
        description: 'Execute an automation task with natural language instruction',
        tags: ['Task'],
        body: TaskRequestSchema,
        response: {
          200: TaskResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const taskService = TaskService.getInstance();
      const wsManager = fastify.wsManager;

      try {
        wsManager.broadcast({
          type: 'task_started',
          url: request.body.url,
          instruction: request.body.instruction,
          timestamp: new Date().toISOString(),
        });

        const result = await taskService.execute(request.body);

        wsManager.broadcast({
          type: 'task_completed',
          url: request.body.url,
          instruction: request.body.instruction,
          timestamp: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        wsManager.broadcast({
          type: 'task_failed',
          url: request.body.url,
          instruction: request.body.instruction,
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
        });

        reply.status(500);
        return {
          success: false,
          error: (error as Error).message,
          actions: [],
        };
      }
    }
  );
};

export default taskRoutes;
