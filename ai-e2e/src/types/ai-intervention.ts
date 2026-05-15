/**
 * AI Intervention Types
 *
 * AI intervention log entity for tracking AI actions during execution.
 */

// ========== ACTION TAKEN ENUM ==========

/**
 * Action taken enum for AI interventions.
 */
export const ActionTaken = {
  DIAGNOSE_ONLY: 'diagnose_only',
  AUTO_FIX_APPLIED: 'auto_fix_applied',
  PENDING_HUMAN_REVIEW: 'pending_human_review',
  HUMAN_APPROVED: 'human_approved',
  HUMAN_REJECTED: 'human_rejected',
} as const;

/**
 * Action taken type derived from const object.
 */
export type ActionTaken = (typeof ActionTaken)[keyof typeof ActionTaken];

// ========== FAILURE TYPE ENUM ==========

/**
 * Failure type enum for AI interventions.
 */
export const FailureType = {
  SELECTOR: 'selector',
  TIMING: 'timing',
  ASSERTION: 'assertion',
  ENVIRONMENT: 'environment',
  DATA: 'data',
  UNKNOWN: 'unknown',
} as const;

/**
 * Failure type derived from const object.
 */
export type FailureType = (typeof FailureType)[keyof typeof FailureType];

// ========== AI INTERVENTION LOG ENTITY ==========

/**
 * AI intervention log entity.
 *
 * Based on database schema:
 * - ai_intervention_logs table with all fields
 */
export interface AIInterventionLog {
  /** Unique intervention log identifier */
  id: string;
  /** Associated execution run ID */
  execution_run_id: string;
  /** Error or issue that triggered intervention */
  trigger: string;
  /** AI diagnosis */
  diagnosis: string;
  /** Suggested fix */
  suggested_fix?: string;
  /** Action taken */
  action_taken: ActionTaken;
  /** Human feedback (optional) */
  human_feedback?: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
}
