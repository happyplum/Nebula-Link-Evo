/**
 * Business Module Types
 *
 * Business module entity and source origin enum for PRD analysis results.
 */

// ========== SOURCE ORIGIN ENUM ==========

/**
 * Source origin values indicating where a module came from.
 */
export const SourceOrigin = {
  AI_GENERATED: 'ai_generated',
  HUMAN_CREATED: 'human_created',
  HUMAN_MODIFIED: 'human_modified',
} as const;

/**
 * Source origin type derived from const object.
 */
export type SourceOrigin = (typeof SourceOrigin)[keyof typeof SourceOrigin];

// ========== BUSINESS MODULE ENTITY ==========

/**
 * Business module entity.
 *
 * Based on database schema:
 * - business_modules table with all fields
 * - description and requirements as JSON strings in DB, parsed to arrays in runtime
 */
export interface BusinessModule {
  /** Unique business module identifier */
  id: string;
  /** Associated project ID */
  project_id: string;
  /** Module name */
  name: string;
  /** Module description */
  description: string[];
  /** List of requirements */
  requirements: string[];
  /** Source origin of this module */
  source_origin: SourceOrigin;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
