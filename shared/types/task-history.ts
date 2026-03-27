/**
 * TaskHistory - History tracking types for task execution
 *
 * This module provides types for tracking the complete execution history of tasks.
 * TaskHistory records the sequence of steps, actions, and their results.
 */

import type { Action } from './action.js';
import type { SimplifiedDOM } from './vision-marker.js';

/**
 * Complete execution history of a task.
 *
 * This interface records the entire lifecycle of a task execution,
 * including all steps, actions, and their outcomes.
 */
export interface TaskHistory {
  /**
   * Unique task identifier (UUID v4)
   */
  taskId: string;

  /**
   * Target URL for the task
   */
  url: string;

  /**
   * User instruction or skill being executed
   */
  instruction: string;

  /**
   * ISO 8601 timestamp when task started
   */
  startTime: string;

  /**
   * ISO 8601 timestamp when task ended (if completed)
   */
  endTime?: string;

  /**
   * Current task status
   */
  status: TaskHistoryStatus;

  /**
   * Total number of steps executed
   */
  stepCount: number;

  /**
   * List of executed steps
   */
  steps: Step[];

  /**
   * Final result message (if completed)
   */
  result?: string;

  /**
   * Error message (if failed)
   */
  error?: string;
}

/**
 * Task execution status
 */
export type TaskHistoryStatus = 'running' | 'completed' | 'failed';

/**
 * Individual step in task execution.
 *
 * Each step records the action taken, its result, and the state
 * (screenshot/DOM) at that point in time.
 */
export interface Step {
  /**
   * Step number (0-indexed)
   */
  step: number;

  /**
   * Action that was executed
   */
  action: Action;

  /**
   * Result of executing the action
   */
  success: boolean;

  /**
   * Human-readable message describing the outcome
   */
  message: string;

  /**
   * Screenshot captured after this step (base64 encoded)
   */
  screenshot?: string;

  /**
   * DOM snapshot captured after this step
   */
  domSnapshot?: SimplifiedDOM;

  /**
   * ISO 8601 timestamp when step was executed
   */
  timestamp: string;
}

/**
 * Factory function to create a new TaskHistory
 *
 * @param taskId - Unique task identifier
 * @param url - Target URL
 * @param instruction - User instruction or skill description
 * @returns New TaskHistory instance
 */
export function createTaskHistory(
  taskId: string,
  url: string,
  instruction: string
): TaskHistory {
  return {
    taskId,
    url,
    instruction,
    startTime: new Date().toISOString(),
    status: 'running',
    stepCount: 0,
    steps: [],
  };
}

/**
 * Creates a new Step record
 *
 * @param stepNumber - Step number (0-indexed)
 * @param action - Action that was executed
 * @param success - Whether the action succeeded
 * @param message - Result message
 * @param screenshot - Optional screenshot
 * @param domSnapshot - Optional DOM snapshot
 * @returns New Step instance
 */
export function createStep(
  stepNumber: number,
  action: Action,
  success: boolean,
  message: string,
  screenshot?: string,
  domSnapshot?: SimplifiedDOM
): Step {
  return {
    step: stepNumber,
    action,
    success,
    message,
    screenshot,
    domSnapshot,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Updates TaskHistory with new step information
 *
 * @param history - Current TaskHistory
 * @param step - Step to add
 * @returns Updated TaskHistory
 */
export function addStepToHistory(history: TaskHistory, step: Step): TaskHistory {
  return {
    ...history,
    stepCount: history.stepCount + 1,
    steps: [...history.steps, step],
  };
}

/**
 * Updates TaskHistory status to completed
 *
 * @param history - Current TaskHistory
 * @param result - Final result message
 * @returns Updated TaskHistory
 */
export function markHistoryCompleted(
  history: TaskHistory,
  result: string
): TaskHistory {
  return {
    ...history,
    status: 'completed',
    endTime: new Date().toISOString(),
    result,
  };
}

/**
 * Updates TaskHistory status to failed
 *
 * @param history - Current TaskHistory
 * @param error - Error message
 * @returns Updated TaskHistory
 */
export function markHistoryFailed(
  history: TaskHistory,
  error: string
): TaskHistory {
  return {
    ...history,
    status: 'failed',
    endTime: new Date().toISOString(),
    error,
  };
}

/**
 * Calculates task duration in milliseconds
 *
 * @param history - TaskHistory to check
 * @returns Duration in milliseconds, or undefined if task is still running
 */
export function getHistoryDuration(history: TaskHistory): number | undefined {
  if (!history.endTime) {
    return undefined;
  }

  const startTime = new Date(history.startTime).getTime();
  const endTime = new Date(history.endTime).getTime();
  return endTime - startTime;
}

/**
 * Gets all successful steps from history
 *
 * @param history - TaskHistory to check
 * @returns Array of successful steps
 */
export function getSuccessfulSteps(history: TaskHistory): Step[] {
  return history.steps.filter((step) => step.success);
}

/**
 * Gets all failed steps from history
 *
 * @param history - TaskHistory to check
 * @returns Array of failed steps
 */
export function getFailedSteps(history: TaskHistory): Step[] {
  return history.steps.filter((step) => !step.success);
}

/**
 * Calculates success rate as a percentage
 *
 * @param history - TaskHistory to check
 * @returns Success rate (0-100), or undefined if no steps
 */
export function getSuccessRate(history: TaskHistory): number | undefined {
  if (history.stepCount === 0) {
    return undefined;
  }

  const successfulCount = getSuccessfulSteps(history).length;
  return (successfulCount / history.stepCount) * 100;
}
