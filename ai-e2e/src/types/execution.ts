/**
 * Execution Types
 *
 * Execution run entity for script execution results.
 */

// ========== EXECUTION STATUS ENUM ==========

/**
 * Execution status values.
 */
export const ExecutionStatus = {
  RUNNING: 'running',
  PASS: 'pass',
  FAIL: 'fail',
  ERROR: 'error',
  TIMEOUT: 'timeout',
} as const;

/**
 * Execution status type derived from const object.
 */
export type ExecutionStatus = (typeof ExecutionStatus)[keyof typeof ExecutionStatus];

// ========== EXECUTION RUN ENTITY ==========

/**
 * Execution run entity.
 *
 * Based on database schema:
 * - execution_runs table with all fields
 * - result_data and screenshots as JSON strings in DB, parsed in runtime
 */
export interface ExecutionRun {
  /** Unique execution run identifier */
  id: string;
  /** Associated script ID */
  script_id: string;
  /** Run number (for multiple runs of same script) */
  run_number: number;
  /** Execution status */
  status: ExecutionStatus;
  /** Start timestamp (ISO string) */
  started_at: string;
  /** End timestamp (ISO string, optional) */
  ended_at?: string;
  /** Error message if failed */
  error_message?: string;
  /** Result data (parsed from JSON in DB) */
  result_data?: Record<string, unknown>;
  /** Screenshots captured during execution (parsed from JSON in DB) */
  screenshots?: string[];
  /** Creation timestamp (ISO string) */
  created_at: string;
}
