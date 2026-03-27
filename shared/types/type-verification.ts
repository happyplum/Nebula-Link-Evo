/**
 * Type verification test for task-context and task-history
 *
 * This file verifies that the new types can be imported and used correctly.
 * It's not a full test suite, just a compilation check.
 */

import {
  type TaskContext,
  type TaskMetadata,
  type TaskStatus,
  createTaskContext,
  updateTaskContext,
  updateTaskMetadata,
  isTaskComplete,
  isTaskSuccessful,
  isTaskFailed,
  isMaxStepsReached,
  getTaskDuration,
} from './task-context.js';

import {
  type TaskHistory,
  type Step,
  type TaskHistoryStatus,
  createTaskHistory,
  createStep,
  addStepToHistory,
  markHistoryCompleted,
  markHistoryFailed,
  getHistoryDuration,
  getSuccessfulSteps,
  getFailedSteps,
  getSuccessRate,
} from './task-history.js';

import type { Action } from './action.js';
import type { SimplifiedDOM } from './vision-marker.js';
import type { ExecutedAction } from './task-context.js';

// Verify TaskContext types can be used
function testTaskContext(): void {
  const context: TaskContext = createTaskContext('https://example.com', 'Test instruction', {
    maxSteps: 5,
  });

  // Assertions for verification (no console in ES2022 without DOM)
  if (context.currentStep !== 0) throw new Error('currentStep should be 0');
  if (context.maxSteps !== 5) throw new Error('maxSteps should be 5');
  if (context.actions.length !== 0) throw new Error('actions should be empty');
  if (context.screenshots.length !== 0) throw new Error('screenshots should be empty');
  if (context.domSnapshots.length !== 0) throw new Error('domSnapshots should be empty');
  if (context.metadata.status !== 'running') throw new Error('status should be running');
}

// Verify TaskHistory types can be used
function testTaskHistory(): void {
  const history: TaskHistory = createTaskHistory('task-123', 'https://example.com', 'Test instruction');

  if (history.status !== 'running') throw new Error('status should be running');
  if (history.stepCount !== 0) throw new Error('stepCount should be 0');
  if (history.steps.length !== 0) throw new Error('steps should be empty');
}

// Verify update functions work correctly
function testUpdateFunctions(): void {
  const context = createTaskContext('https://example.com', 'Test instruction');

  const action: Action = {
    type: 'click',
    params: { x: 100, y: 200 },
  };

  const result: ExecutedAction = {
    action,
    success: true,
    message: 'Clicked successfully',
  };

  const domSnapshot: SimplifiedDOM = {
    elements: [],
    viewport: { width: 1920, height: 1080 },
  };

  const updatedContext = updateTaskContext(context, action, result, 'base64-screenshot', domSnapshot);

  if (updatedContext.currentStep !== 1) throw new Error('currentStep should be 1');
  if (updatedContext.actions.length !== 1) throw new Error('actions should have 1 item');
}

// Verify helper functions work correctly
function testHelperFunctions(): void {
  const context = createTaskContext('https://example.com', 'Test instruction');
  const history = createTaskHistory('task-123', 'https://example.com', 'Test instruction');

  if (isTaskComplete(context)) throw new Error('Task should not be complete');
  if (isTaskSuccessful(context)) throw new Error('Task should not be successful');
  if (isTaskFailed(context)) throw new Error('Task should not be failed');
  if (isMaxStepsReached(context)) throw new Error('Max steps should not be reached');
  if (getTaskDuration(context) !== undefined) throw new Error('Duration should be undefined for running task');

  if (getHistoryDuration(history) !== undefined) throw new Error('Duration should be undefined for running history');
  if (getSuccessRate(history) !== undefined) throw new Error('Success rate should be undefined with no steps');
}

// Run all tests
export function runVerificationTests(): void {
  testTaskContext();
  testTaskHistory();
  testUpdateFunctions();
  testHelperFunctions();
}