import { WebSocket } from '@fastify/websocket';
import { TaskState, TaskAction } from './types';
import { TaskHistory } from './history';
import { WebSocketManager } from './websocket';
import { HistoryManager } from './history';

export class DebugModule {
  private tasks: Map<string, TaskState> = new Map();
  private wsConnections: Set<WebSocket> = new Set();
  private wsManager: WebSocketManager;
  private historyManager: HistoryManager;
  private currentTaskId: string | null = null;

  constructor() {
    this.wsManager = new WebSocketManager();
    this.historyManager = new HistoryManager();
  }

  createTask(url: string, instruction: string, maxSteps?: number): string {
    const id = Date.now().toString();
    const task: TaskState = {
      id,
      url,
      instruction,
      status: 'idle',
      currentStep: 0,
      maxSteps: maxSteps || 10,
      actions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(id, task);
    this.historyManager.add({
      taskId: task.id,
      url: task.url,
      instruction: task.instruction,
      startTime: task.createdAt.toISOString(),
      status: 'running',
      stepCount: 0,
      steps: [],
    });
    this.broadcast({ type: 'task_created', task });
    return id;
  }

  updateTaskStatus(id: string, status: TaskState['status']) {
    const task = this.tasks.get(id);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
      this.broadcast({ type: 'task_status', taskId: id, status });
    }
  }

  addAction(taskId: string, action: TaskAction) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.actions.push(action);
      task.currentStep++;
      task.updatedAt = new Date();
      this.broadcast({
        type: 'action_added',
        taskId,
        action,
      });
    }
  }

  updateScreenshot(taskId: string, screenshot: string) {
    const task = this.tasks.get(taskId);
    if (task) {
      task.screenshot = screenshot;
      task.updatedAt = new Date();
      this.broadcast({
        type: 'screenshot_updated',
        taskId,
        screenshot,
      });
    }
  }

  addConnection(ws: WebSocket) {
    this.wsManager.add(ws);
    this.wsConnections.add(ws);
  }

  removeConnection(ws: WebSocket) {
    this.wsManager.remove(ws);
    this.wsConnections.delete(ws);
  }

  broadcast(message: any) {
    this.wsManager.broadcast(message);
  }

  getTask(id: string): TaskState | undefined {
    return this.tasks.get(id);
  }

  listTasks(): TaskState[] {
    return Array.from(this.tasks.values());
  }

  getHistory(limit?: number): TaskHistory[] {
    return this.historyManager.get(limit);
  }

  getHistoryById(id: string): TaskHistory | undefined {
    return this.historyManager.getById(id);
  }

  clearHistory() {
    this.historyManager.clear();
  }

  handleCommand(command: any): void {
    const taskId = command.taskId || this.currentTaskId;

    switch (command.type) {
      case 'pause':
        if (taskId) {
          this.currentTaskId = taskId;
          this.updateTaskStatus(taskId, 'paused');
        }
        break;

      case 'resume':
        if (taskId) {
          this.currentTaskId = taskId;
          this.updateTaskStatus(taskId, 'running');
        }
        break;

      case 'modify':
        if (taskId && command.instruction) {
          const task = this.tasks.get(taskId);
          if (task) {
            task.instruction = command.instruction;
            task.updatedAt = new Date();
            this.broadcast({
              type: 'task_modified',
              taskId,
              instruction: command.instruction,
              timestamp: new Date().toISOString(),
            });
          }
        }
        break;

      case 'manual_action':
        if (taskId && command.action) {
          this.currentTaskId = taskId;
          this.executeManualAction(taskId, command.action);
        }
        break;
    }
  }

  private executeManualAction(taskId: string, action: any): void {
    const task = this.tasks.get(taskId);
    if (task) {
      this.broadcast({
        type: 'manual_action_started',
        taskId,
        action,
        timestamp: new Date().toISOString(),
      });
    }
  }

  setCurrentTaskId(taskId: string | null): void {
    this.currentTaskId = taskId;
  }
}
