/**
 * State Machine Types
 *
 * Project mode enum, transition rules, and mode definitions.
 */

import type { ProjectStatus } from './project.js';
import { ProjectStatus as ProjectStatusValues } from './project.js';

// ========== PROJECT MODE ENUM ==========

/**
 * Project mode values derived from status.
 * Modes represent high-level phases of the workflow.
 */
export const ProjectMode = {
  CONFIG: 'config',
  ANALYSIS: 'analysis',
  EXPLORATION: 'exploration',
  GENERATION: 'generation',
  EXECUTION: 'execution',
} as const;

/**
 * Project mode type derived from const object.
 */
export type ProjectMode = (typeof ProjectMode)[keyof typeof ProjectMode];

// ========== STATUS TO MODE MAPPING ==========

/**
 * Maps project statuses to their corresponding modes.
 */
export const STATUS_TO_MODE: Record<ProjectStatus, ProjectMode> = {
  draft: 'config',
  configuring: 'config',
  analyzing: 'analysis',
  analyzed: 'analysis',
  exploring: 'exploration',
  explored: 'exploration',
  generating: 'generation',
  ready: 'generation',
  running: 'execution',
  completed: 'execution',
};

// ========== VALID TRANSITIONS ==========

/**
 * Valid state transitions.
 * Each status maps to a list of valid next statuses.
 */
export const VALID_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['configuring'],
  configuring: ['analyzing', 'draft'],
  analyzing: ['analyzed', 'configuring'],
  analyzed: ['exploring', 'analyzing'],
  exploring: ['explored', 'analyzed'],
  explored: ['generating', 'exploring'],
  generating: ['ready', 'explored'],
  ready: ['running', 'generating'],
  running: ['completed', 'ready'],
  completed: ['running', 'ready'],
};

// ========== MODE ENTRY REQUIREMENTS ==========

/**
 * Mode entry requirements.
 * Each mode defines required statuses and required data fields.
 */
export interface ModeRequirements {
  config: {
    /** Required statuses to enter config mode */
    requiredStatuses: [typeof ProjectStatusValues.DRAFT];
  };
  analysis: {
    /** Required statuses to enter analysis mode */
    requiredStatuses: [typeof ProjectStatusValues.CONFIGURING];
    /** Required project fields */
    requires: ['target_base_url'];
  };
  exploration: {
    /** Required statuses to enter exploration mode */
    requiredStatuses: [typeof ProjectStatusValues.ANALYZED];
    /** Required project fields */
    requires: ['business_modules'];
  };
  generation: {
    /** Required statuses to enter generation mode */
    requiredStatuses: [typeof ProjectStatusValues.EXPLORED];
    /** Required project fields */
    requires: ['url_bindings'];
  };
  execution: {
    /** Required statuses to enter execution mode */
    requiredStatuses: [typeof ProjectStatusValues.READY];
    /** Required project fields */
    requires: ['scripts'];
  };
}

// ========== TYPE GUARDS ==========

/**
 * Type guard to check if a value is a valid ProjectMode.
 */
export function isProjectMode(value: string): value is ProjectMode {
  return Object.values(ProjectMode).includes(value as ProjectMode);
}

/**
 * Type guard to check if a status transition is valid.
 */
export function isValidTransition(
  from: ProjectStatus,
  to: ProjectStatus
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get the mode for a given status.
 */
export function getModeForStatus(status: ProjectStatus): ProjectMode {
  return STATUS_TO_MODE[status];
}
