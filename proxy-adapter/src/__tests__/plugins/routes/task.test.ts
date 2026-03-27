import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import taskRoutes from '../../../plugins/routes/task.js';
import errorHandler from '../../../plugins/03-error-handler.plugin.js';
import swaggerPlugin from '../../../plugins/02-swagger.plugin.js';
import { TaskService } from '../../../services/index.js';

// Mock TaskService
vi.mock('../../../services/index.js', () => ({
  TaskService: {
    getInstance: vi.fn(),
  },
}));

describe('Task Routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockWsManager: any;
  let mockTaskService: any;

  beforeEach(() => {
    // Create mock WebSocket manager
    mockWsManager = {
      broadcast: vi.fn(),
    };

    // Create mock TaskService
    mockTaskService = {
      execute: vi.fn(),
    };
    (TaskService.getInstance as any).mockReturnValue(mockTaskService);

    // Create Fastify app
    app = Fastify();
    app.register(swaggerPlugin);
    app.register(errorHandler);
    app.decorate('wsManager', mockWsManager);
    app.register(taskRoutes);
  });

  afterEach(() => {
    app.close();
    vi.clearAllMocks();
  });

  describe('POST /', () => {
    it('should execute task successfully', async () => {
      const mockResult = {
        success: true,
        url: 'https://example.com',
        actions: [
          {
            action: {
              type: 'click',
              params: { x: 500, y: 300 },
              reasoning: 'Click button',
            },
            success: true,
            message: 'Clicked at (500, 300)',
          },
        ],
        result: 'Task completed',
      };
      mockTaskService.execute.mockResolvedValue(mockResult);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          url: 'https://example.com',
          instruction: 'Click the submit button',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body).toEqual(mockResult);

      // Verify task_started broadcast
      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_started',
          url: 'https://example.com',
          instruction: 'Click the submit button',
        })
      );

      // Verify task_completed broadcast
      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_completed',
          url: 'https://example.com',
          instruction: 'Click the submit button',
        })
      );

      expect(mockTaskService.execute).toHaveBeenCalledWith({
        url: 'https://example.com',
        instruction: 'Click the submit button',
      });
    });

    it('should execute task with context', async () => {
      const mockResult = {
        success: true,
        url: 'https://example.com',
        actions: [],
        result: 'Task completed',
      };
      mockTaskService.execute.mockResolvedValue(mockResult);

      const payload = {
        url: 'https://example.com',
        instruction: 'Fill form',
        context: {
          maxSteps: 20,
          previousActions: [],
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(mockTaskService.execute).toHaveBeenCalledWith(payload);
    });

    it('should handle task execution error and return 500', async () => {
      const error = new Error('Failed to execute task');
      mockTaskService.execute.mockRejectedValue(error);

      const response = await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          url: 'https://example.com',
          instruction: 'Click button',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.payload);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Failed to execute task');
      expect(body.actions).toEqual([]);

      // Verify task_failed broadcast
      expect(mockWsManager.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'task_failed',
          url: 'https://example.com',
          instruction: 'Click button',
          error: 'Failed to execute task',
        })
      );
    });

    it('should broadcast timestamp in WebSocket events', async () => {
      const mockResult = {
        success: true,
        url: 'https://example.com',
        actions: [],
        result: 'Task completed',
      };
      mockTaskService.execute.mockResolvedValue(mockResult);

      await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          url: 'https://example.com',
          instruction: 'Test instruction',
        },
      });

      // Verify all broadcasts include timestamp
      const calls = mockWsManager.broadcast.mock.calls;
      expect(calls).toHaveLength(2);

      expect(calls[0][0]).toHaveProperty('timestamp');
      expect(calls[0][0].type).toBe('task_started');

      expect(calls[1][0]).toHaveProperty('timestamp');
      expect(calls[1][0].type).toBe('task_completed');
    });

    it('should return error message in task_failed event', async () => {
      const error = new Error('Browser connection lost');
      mockTaskService.execute.mockRejectedValue(error);

      await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          url: 'https://example.com',
          instruction: 'Navigate to page',
        },
      });

      // Verify task_failed broadcast includes error message
      const failedCall = mockWsManager.broadcast.mock.calls.find(
        (call: any) => call[0].type === 'task_failed'
      );
      expect(failedCall).toBeDefined();
      expect(failedCall[0].error).toBe('Browser connection lost');
    });

    it('should broadcast task_started before executing task', async () => {
      const mockResult = {
        success: true,
        url: 'https://example.com',
        actions: [],
        result: 'Task completed',
      };

      mockTaskService.execute.mockImplementation(async () => {
        // Check broadcast calls at this point
        const callsBefore = mockWsManager.broadcast.mock.calls;
        expect(callsBefore).toHaveLength(1);
        expect(callsBefore[0][0].type).toBe('task_started');

        return mockResult;
      });

      await app.inject({
        method: 'POST',
        url: '/',
        payload: {
          url: 'https://example.com',
          instruction: 'Test instruction',
        },
      });

      const callsAfter = mockWsManager.broadcast.mock.calls;
      expect(callsAfter).toHaveLength(2);
      expect(callsAfter[0][0].type).toBe('task_started');
      expect(callsAfter[1][0].type).toBe('task_completed');
    });
  });
});
