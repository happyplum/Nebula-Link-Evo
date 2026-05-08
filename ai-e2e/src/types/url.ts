/**
 * URL and Binding Types
 *
 * URL entity and URL-module binding entity for exploration results.
 */

// ========== BINDING STATUS ENUM ==========

/**
 * Binding status values for URL-module associations.
 */
export const BindingStatus = {
  AI_PROPOSED: 'ai_proposed',
  HUMAN_CONFIRMED: 'human_confirmed',
  HUMAN_MODIFIED: 'human_modified',
  REJECTED: 'rejected',
} as const;

/**
 * Binding status type derived from const object.
 */
export type BindingStatus = (typeof BindingStatus)[keyof typeof BindingStatus];

// ========== URL ENTITY ==========

/**
 * URL entity representing a discovered URL.
 *
 * Based on database schema:
 * - urls table with all fields
 */
export interface URL {
  /** Unique URL identifier */
  id: string;
  /** Associated project ID */
  project_id: string;
  /** Full URL */
  url: string;
  /** URL path */
  path: string;
  /** Page title (optional) */
  title?: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
}

// ========== URL MODULE BINDING ENTITY ==========

/**
 * URL-module binding entity.
 *
 * Based on database schema:
 * - url_module_bindings table with all fields
 * - Links URLs to business/functional modules
 */
export interface URLModuleBinding {
  /** Unique binding identifier */
  id: string;
  /** Associated URL ID */
  url_id: string;
  /** Associated business module ID (optional) */
  business_module_id?: string;
  /** Associated functional module ID (optional) */
  functional_module_id?: string;
  /** Binding status */
  status: BindingStatus;
  /** AI confidence score (0-1) */
  confidence?: number;
  /** Human-provided notes (optional) */
  notes?: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
