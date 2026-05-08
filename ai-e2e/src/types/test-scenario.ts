/**
 * Test Scenario Types
 *
 * Test scenario entity for defining test cases.
 */

// ========== TEST SCENARIO ENTITY ==========

/**
 * Test scenario entity.
 *
 * Based on database schema:
 * - test_scenarios table with all fields
 * - Associated with a functional module via functional_module_id
 */
export interface TestScenario {
  /** Unique test scenario identifier */
  id: string;
  /** Associated functional module ID */
  functional_module_id: string;
  /** Test scenario name */
  name: string;
  /** Test scenario description */
  description: string;
  /** Pre-conditions for this scenario */
  preconditions?: string[];
  /** Expected results */
  expected_results?: string[];
  /** Creation timestamp (ISO string) */
  created_at: string;
  /** Last update timestamp (ISO string) */
  updated_at: string;
}
