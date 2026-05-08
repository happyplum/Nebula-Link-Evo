/**
 * Script Types
 *
 * Script entity for generated test scripts.
 */

// ========== GENERATED VALUE ENUM ==========

/**
 * Generated value enum indicating how a field was created.
 */
export const GeneratedValue = {
  AI_GENERATED: 'ai_generated',
  HUMAN_EDITED: 'human_edited',
  AI_AUTO_FIX: 'ai_auto_fix',
} as const;

/**
 * Generated value type derived from const object.
 */
export type GeneratedValue = (typeof GeneratedValue)[keyof typeof GeneratedValue];

// ========== SCRIPT STATUS ENUM ==========

/**
 * Script status values.
 */
export const ScriptStatus = {
  GENERATED: 'generated',
  EDITING: 'editing',
  EDITED: 'edited',
  EXECUTING: 'executing',
  PASSED: 'passed',
  FAILED: 'failed',
  PENDING_REVIEW: 'pending_review',
} as const;

/**
 * Script status type derived from const object.
 */
export type ScriptStatus = (typeof ScriptStatus)[keyof typeof ScriptStatus];

// ========== SCRIPT ENTITY ==========

/**
 * Script entity.
 *
 * Based on database schema:
 * - scripts table with all fields
 * - content and actions as JSON strings in DB, parsed in runtime
 */
export interface Script {
  /** Unique script identifier */
  id: string;
  /** Associated test scenario ID */
  test_scenario_id: string;
  /** Script name */
  name: string;
  /** Script source (who generated it) */
  generated_by: GeneratedValue;
  /** Script status */
  status: ScriptStatus;
  /** Script content (parsed from JSON in DB) */
  content: Record<string, unknown>;
  /** List of actions (parsed from JSON in DB) */
  actions: unknown[];
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
