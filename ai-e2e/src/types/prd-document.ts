/**
 * PRD Document Types
 *
 * PRD (Product Requirements Document) entity for storing requirements.
 */

// ========== PRD DOCUMENT ENTITY ==========

/**
 * PRD Document entity.
 *
 * Based on database schema:
 * - prd_documents table with all fields
 * - Content stored as JSON string in DB, parsed to object in runtime
 */
export interface PRDDocument {
  /** Unique PRD document identifier */
  id: string;
  /** Associated project ID */
  project_id: string;
  /** PRD content (parsed from JSON in DB) */
  content: Record<string, unknown>;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
