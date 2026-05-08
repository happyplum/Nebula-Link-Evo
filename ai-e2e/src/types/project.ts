/**
 * Project Types
 *
 * Core project entity and status enum for the AI E2E testing tool.
 */

// ========== STATUS ENUM ==========

/**
 * Project status values using `as const` pattern.
 */
export const ProjectStatus = {
  DRAFT: 'draft',
  CONFIGURING: 'configuring',
  ANALYZING: 'analyzing',
  ANALYZED: 'analyzed',
  EXPLORING: 'exploring',
  EXPLORED: 'explored',
  GENERATING: 'generating',
  READY: 'ready',
  RUNNING: 'running',
  COMPLETED: 'completed',
} as const;

/**
 * Project status type derived from const object.
 */
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];

// ========== PROJECT ENTITY ==========

/**
 * Project entity representing an E2E testing project.
 *
 * Based on database schema:
 * - projects table with all fields
 * - Optional fields: target_base_url, description, tags, login_script_id, completed_at
 * - Date fields as ISO strings
 * - JSON fields as parsed types
 */
export interface Project {
  /** Unique project identifier */
  id: string;
  /** Project name */
  name: string;
  /** Target base URL for testing */
  target_base_url?: string;
  /** Project description */
  description?: string;
  /** Current project status */
  status: ProjectStatus;
  /** Optional project tags */
  tags?: string[];
  /** Associated login script ID */
  login_script_id?: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
  /** Completion timestamp (ISO string, optional) */
  completed_at?: string;
}
