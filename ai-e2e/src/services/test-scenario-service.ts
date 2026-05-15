/**
 * Test Scenario Service
 *
 * CRUD operations for test scenarios, handling the mapping between
 * `test_data_json` (DB column) and `preconditions`/`expected_results` (domain type).
 *
 * - getScenario: reads from repo, parses test_data_json → domain type
 * - updateScenario: serializes preconditions/expected_results → test_data_json, calls repo.update()
 * - listScenariosByModule: lists and parses each scenario for a functional module
 *
 * Malformed JSON in existing test_data_json is handled gracefully (defaults to empty arrays).
 */
import type {
  TestScenarioRepository,
  TestScenario as RepoTestScenario,
} from '../database/repositories/test-scenario-repository.js';
import type { TestScenario } from '../types/test-scenario.js';

/** Input data for updating a scenario. All fields optional. */
export interface UpdateScenarioInput {
  name?: string;
  description?: string;
  preconditions?: string[];
  expected_results?: string[];
}

/** Parsed test data structure stored in test_data_json */
interface TestData {
  preconditions: string[];
  expected_results: string[];
}

/**
 * Parse test_data_json, returning empty arrays for null or malformed JSON.
 */
function parseTestData(raw: string | null): TestData {
  if (!raw) return { preconditions: [], expected_results: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      preconditions: Array.isArray(parsed.preconditions) ? parsed.preconditions : [],
      expected_results: Array.isArray(parsed.expected_results) ? parsed.expected_results : [],
    };
  } catch {
    return { preconditions: [], expected_results: [] };
  }
}

/**
 * Map a repo row to a domain TestScenario, parsing test_data_json.
 */
function toDomain(row: RepoTestScenario): TestScenario {
  const testData = parseTestData(row.test_data_json);
  return {
    id: row.id,
    functional_module_id: row.functional_module_id,
    name: row.name,
    description: row.description ?? '',
    preconditions: testData.preconditions,
    expected_results: testData.expected_results,
    created_at: row.created_at,
    updated_at: row.created_at, // repo row has no updated_at; use created_at
  };
}

export class TestScenarioService {
  constructor(private readonly repo: TestScenarioRepository) {}

  /**
   * Get a single scenario by ID, with parsed test_data.
   */
  getScenario(id: string): TestScenario | null {
    const row = this.repo.findById(id);
    if (!row) return null;
    return toDomain(row);
  }

  /**
   * Update a scenario. Serializes preconditions/expected_results into test_data_json.
   * The repo always sets source to 'human_modified'.
   */
  updateScenario(id: string, data: UpdateScenarioInput): TestScenario | null {
    const updateData: Record<string, unknown> = {};

    if (data.name !== undefined) {
      updateData.name = data.name;
    }
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    if (data.preconditions !== undefined || data.expected_results !== undefined) {
      // Merge with existing data if only partial update
      const existing = this.repo.findById(id);
      const current = existing ? parseTestData(existing.test_data_json) : { preconditions: [], expected_results: [] };
      updateData.test_data_json = JSON.stringify({
        preconditions: data.preconditions ?? current.preconditions,
        expected_results: data.expected_results ?? current.expected_results,
      });
    }

    const updated = this.repo.update(id, updateData as import('../database/repositories/test-scenario-repository.js').UpdateTestScenarioData);
    if (!updated) return null;
    return toDomain(updated);
  }

  /**
   * List all scenarios for a functional module, with parsed test_data.
   */
  listScenariosByModule(functionalModuleId: string): TestScenario[] {
    return this.repo.findByFunctionalModuleId(functionalModuleId).map(toDomain);
  }
}
