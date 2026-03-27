import type { DOMSnapshotResponse, ActionParams } from '@nebula-link-evo/shared';

export interface TaskState {
  id: string;
  url: string;
  instruction: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  currentStep: number;
  maxSteps: number;
  screenshot?: string;
  dom?: DOMSnapshotResponse;
  actions: TaskAction[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskAction {
  step: number;
  action: {
    type: 'click' | 'type' | 'scroll' | 'wait' | 'finish';
    params: ActionParams;
    reasoning: string;
  };
  success: boolean;
  message: string;
  timestamp: Date;
}
