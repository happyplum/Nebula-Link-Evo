/**
 * Login Script Types
 *
 * Login script entity and login step type for authentication flows.
 */

// ========== LOGIN STEP TYPE ==========

/**
 * Login step type representing a single step in login flow.
 */
export interface LoginStep {
  /** Step type */
  type: 'navigate' | 'fill' | 'click' | 'wait' | 'screenshot';
  /** Step description */
  description: string;
  /** Target selector (for fill/click) */
  selector?: string;
  /** Value to input (for fill) */
  value?: string;
  /** URL to navigate to (for navigate) */
  url?: string;
  /** Wait duration in milliseconds (for wait) */
  duration?: number;
}

// ========== LOGIN SCRIPT ENTITY ==========

/**
 * Login script entity.
 *
 * Based on database schema:
 * - login_scripts table with all fields
 * - steps as JSON string in DB, parsed to array in runtime
 */
export interface LoginScript {
  /** Unique login script identifier */
  id: string;
  /** Login script name */
  name: string;
  /** Description of what this script does */
  description?: string;
  /** List of login steps (parsed from JSON in DB) */
  steps: LoginStep[];
  /** Whether this script is reusable across projects */
  is_reusable: boolean;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
