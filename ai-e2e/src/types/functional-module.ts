/**
 * Functional Module Types
 *
 * Functional module entity for detailed functionality breakdown.
 */

// ========== FUNCTIONAL MODULE ENTITY ==========

/**
 * Functional module entity.
 *
 * Based on database schema:
 * - functional_modules table with all fields
 * - Associated with a business module via business_module_id
 */
export interface FunctionalModule {
  /** Unique functional module identifier */
  id: string;
  /** Associated business module ID */
  business_module_id: string;
  /** Functional module name */
  name: string;
  /** Functional module description */
  description: string;
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
