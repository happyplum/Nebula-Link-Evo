/**
 * TaskContext - Immutable state container for task execution
 *
 * This module provides the core state management types for TaskExecutor refactoring.
 * TaskContext tracks the current execution state, including actions, screenshots,
 * and DOM snapshots collected during task execution.
 */

import type { Action } from './action.js';
import type { SimplifiedDOM } from './vision-marker.js';
import { generateUUID } from '../utils/uuid.js';

/**
import type { SimplifiedDOM } from './vision-marker.js';
import { generateUUID } from '../utils/uuid.js';

export type { SimplifiedDOM };


/**
 * Result of executing an action.
 * Records whether the action succeeded and any output.
 */
export interface ExecutedAction {
  /** Action that was executed */
  action: Action;
  /** Whether execution succeeded */
  success: boolean;
  /** Human-readable result message */
  message?: string;
  /** Screenshot captured after action (base64) */
  screenshot?: string;
}


/**
 * Immutable state container for a running task.
 *
 * This interface provides type-safe state tracking throughout task execution.
 * All state transitions should create new instances rather than mutating existing ones.
 */
export interface TaskContext {
  /**
   * Current step number (0-indexed)
   */
  currentStep: number;

  /**
   * Maximum number of steps allowed
   */
  maxSteps: number;

  /**
   * List of actions executed so far
   */
  actions: ExecutedAction[];

  /**
   * Screenshots captured at each step (base64 encoded)
   * Index corresponds to the step number
   */
  screenshots: string[];

  /**
   * DOM snapshots captured at each step
   * Index corresponds to the step number
   */
  domSnapshots: SimplifiedDOM[];

  /**
   * Task metadata for extensibility
   * Can include custom fields for debugging, metrics, etc.
   */
  metadata: TaskMetadata;
}

/**
 * Task metadata for tracking additional execution information
 */
export interface TaskMetadata {
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
   * Skill ID if executing a predefined skill
   */
  skillId?: string;

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
  status: TaskStatus;

  /**
   * Final result message (if completed)
   */
  result?: string;

  /**
   * Error message (if failed)
   */
  error?: string;

  /**
   * Additional custom metadata fields
   */
  [key: string]: unknown;
}

/**
 * Task execution status
 */
export type TaskStatus = 'running' | 'completed' | 'failed';

/**
 * Factory function to create a new TaskContext
 *
 * @param url - Target URL
 * @param instruction - User instruction or skill description
 * @param options - Optional configuration
 * @returns New TaskContext instance
 */
export function createTaskContext(
  url: string,
  instruction: string,
  options: TaskContextOptions = {}
): TaskContext {
  const {
    maxSteps = 10,
    skillId,
    taskId = generateUUID(),
    metadata = {},
  } = options;

  return {
    currentStep: 0,
    maxSteps,
    actions: [],
    screenshots: [],
    domSnapshots: [],
    metadata: {
      taskId,
      url,
      instruction,
      skillId,
      startTime: new Date().toISOString(),
      status: 'running',
      ...metadata,
    },
  };
}

/**
 * Options for creating a TaskContext
 */
export interface TaskContextOptions {
  /**
   * Maximum number of steps (default: 10)
   */
  maxSteps?: number;

  /**
   * Skill ID if executing a predefined skill
   */
  skillId?: string;

  /**
   * Custom task ID (default: auto-generated UUID)
   */
  taskId?: string;

  /**
   * Additional metadata fields
   */
  metadata?: Partial<TaskMetadata>;
}

/**
 * Creates a new TaskContext with updated state after executing an action
 *
 * @param context - Current TaskContext
 * @param action - Action that was executed
 * @param result - ExecutedAction from executing the action
 * @param screenshot - Screenshot captured after the action
 * @param domSnapshot - DOM snapshot captured after the action
 * @returns New TaskContext with updated state
 */
export function updateTaskContext(
  context: TaskContext,
  action: Action,
  result: ExecutedAction,
  screenshot?: string,
  domSnapshot?: SimplifiedDOM
): TaskContext {
  return {
    ...context,
    currentStep: context.currentStep + 1,
    actions: [...context.actions, result],
    screenshots: screenshot
      ? [...context.screenshots, screenshot]
      : context.screenshots,
    domSnapshots: domSnapshot
      ? [...context.domSnapshots, domSnapshot]
      : context.domSnapshots,
  };
}

/**
 * Updates TaskContext metadata (status, result, error, etc.)
 *
 * @param context - Current TaskContext
 * @param updates - Partial metadata updates
 * @returns New TaskContext with updated metadata
 */
export function updateTaskMetadata(
  context: TaskContext,
  updates: Partial<TaskMetadata>
): TaskContext {
  return {
    ...context,
    metadata: {
      ...context.metadata,
      ...updates,
    },
  };
}

/**
 * Checks if the task context indicates completion
 *
 * @param context - TaskContext to check
 * @returns true if task is completed or failed
 */
export function isTaskComplete(context: TaskContext): boolean {
  return (
    context.metadata.status === 'completed' ||
    context.metadata.status === 'failed'
  );
}

/**
 * Checks if the task context indicates successful completion
 *
 * @param context - TaskContext to check
 * @returns true if task is completed successfully
 */
export function isTaskSuccessful(context: TaskContext): boolean {
  return context.metadata.status === 'completed';
}

/**
 * Checks if the task context indicates a failure
 *
 * @param context - TaskContext to check
 * @returns true if task has failed
 */
export function isTaskFailed(context: TaskContext): boolean {
  return context.metadata.status === 'failed';
}

/**
 * Checks if the task has reached maximum steps
 *
 * @param context - TaskContext to check
 * @returns true if currentStep >= maxSteps
 */
export function isMaxStepsReached(context: TaskContext): boolean {
  return context.currentStep >= context.maxSteps;
}

/**
 * Calculates task duration in milliseconds
 *
 * @param context - TaskContext to check
 * @returns Duration in milliseconds, or undefined if task is still running
 */
export function getTaskDuration(context: TaskContext): number | undefined {
  if (!context.metadata.endTime) {
    return undefined;
  }

  const startTime = new Date(context.metadata.startTime).getTime();
  const endTime = new Date(context.metadata.endTime).getTime();
  return endTime - startTime;
}
