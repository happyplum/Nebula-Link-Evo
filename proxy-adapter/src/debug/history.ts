import { Action } from '../config/schema.js';

export interface TaskHistory {
  taskId: string;
  url: string;
  instruction: string;
  startTime: string;
  endTime?: string;
  status: 'running' | 'completed' | 'failed';
  stepCount: number;
  steps: Step[];
  result?: string;
  error?: string;
}

export interface Step {
  step: number;
  action: Action;
  success: boolean;
  message: string;
  screenshot?: string;
  timestamp: string;
}

export class HistoryManager {
  private history: TaskHistory[] = [];
  private maxHistory = 20;

  add(task: TaskHistory): void {
    this.history.unshift(task);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(0, this.maxHistory);
    }
  }

  get(limit?: number): TaskHistory[] {
    if (limit && limit > 0) {
      return this.history.slice(0, limit);
    }
    return [...this.history];
  }

  getById(id: string): TaskHistory | undefined {
    return this.history.find((task) => task.taskId === id);
  }

  update(id: string, updates: Partial<TaskHistory>): void {
    const task = this.history.find((t) => t.taskId === id);
    if (task) {
      Object.assign(task, updates);
    }
  }

  clear(): void {
    this.history = [];
  }
}
