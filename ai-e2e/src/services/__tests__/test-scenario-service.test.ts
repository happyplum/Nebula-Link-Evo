import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  TestScenarioRepository,
  TestScenario as RepoTestScenario,
  UpdateTestScenarioData,
} from '../../database/repositories/test-scenario-repository.js';
import { TestScenarioService } from '../test-scenario-service.js';

// ---------- Helpers ----------

function makeRepoScenario(overrides: Partial<RepoTestScenario> = {}): RepoTestScenario {
  return {
    id: 'ts-1',
    functional_module_id: 'fm-1',
    name: 'Login test',
    description: 'Verify user can log in',
    test_data_json: JSON.stringify({
      preconditions: ['User account exists'],
      expected_results: ['Dashboard is shown'],
    }),
    sort_order: 0,
    source: 'ai_generated',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockRepo(store?: Map<string, RepoTestScenario>): TestScenarioRepository {
  const db = store ?? new Map<string, RepoTestScenario>();

  return {
    findById: vi.fn((id: string) => db.get(id) ?? null),
    findByFunctionalModuleId: vi.fn((fmId: string) =>
      Array.from(db.values()).filter((s) => s.functional_module_id === fmId),
    ),
    update: vi.fn((id: string, data: UpdateTestScenarioData) => {
      const existing = db.get(id);
      if (!existing) return null;
      const updated: RepoTestScenario = {
        ...existing,
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.test_data_json !== undefined ? { test_data_json: data.test_data_json } : {}),
        source: 'human_modified',
      };
      db.set(id, updated);
      return updated;
    }),
    create: vi.fn(),
    delete: vi.fn(),
  } as unknown as TestScenarioRepository;
}

// ---------- Tests ----------

describe('TestScenarioService', () => {
  let service: TestScenarioService;
  let repo: TestScenarioRepository;

  beforeEach(() => {
    repo = createMockRepo();
    service = new TestScenarioService(repo);
  });

  describe('getScenario', () => {
    it('returns scenario with parsed test_data (preconditions/expected_results)', () => {
      const row = makeRepoScenario();
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(row);

      const result = service.getScenario('ts-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ts-1');
      expect(result!.name).toBe('Login test');
      expect(result!.preconditions).toEqual(['User account exists']);
      expect(result!.expected_results).toEqual(['Dashboard is shown']);
    });

    it('returns null when scenario not found', () => {
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const result = service.getScenario('nonexistent');

      expect(result).toBeNull();
    });

    it('handles null test_data_json gracefully', () => {
      const row = makeRepoScenario({ test_data_json: null });
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(row);

      const result = service.getScenario('ts-1');

      expect(result).not.toBeNull();
      expect(result!.preconditions).toEqual([]);
      expect(result!.expected_results).toEqual([]);
    });

    it('handles malformed test_data_json gracefully', () => {
      const row = makeRepoScenario({ test_data_json: '{invalid json' });
      (repo.findById as ReturnType<typeof vi.fn>).mockReturnValue(row);

      const result = service.getScenario('ts-1');

      expect(result).not.toBeNull();
      expect(result!.preconditions).toEqual([]);
      expect(result!.expected_results).toEqual([]);
    });
  });

  describe('updateScenario', () => {
    it('updates scenario and sets source to human_modified', () => {
      const row = makeRepoScenario();
      const store = new Map<string, RepoTestScenario>([['ts-1', row]]);
      repo = createMockRepo(store);
      service = new TestScenarioService(repo);

      const result = service.updateScenario('ts-1', {
        name: 'Updated login test',
        preconditions: ['User exists', 'Browser open'],
        expected_results: ['Logged in', 'Dashboard visible'],
      });

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated login test');
      expect(result!.preconditions).toEqual(['User exists', 'Browser open']);
      expect(result!.expected_results).toEqual(['Logged in', 'Dashboard visible']);

      // Verify repo.update was called with serialized test_data_json
      expect(repo.update).toHaveBeenCalledWith(
        'ts-1',
        expect.objectContaining({
          name: 'Updated login test',
          test_data_json: expect.any(String),
        }),
      );

      // Verify the serialized JSON
      const updateCall = (repo.update as ReturnType<typeof vi.fn>).mock.calls[0][1] as UpdateTestScenarioData;
      const parsed = JSON.parse(updateCall.test_data_json!);
      expect(parsed.preconditions).toEqual(['User exists', 'Browser open']);
      expect(parsed.expected_results).toEqual(['Logged in', 'Dashboard visible']);
    });

    it('returns null when updating nonexistent scenario', () => {
      const result = service.updateScenario('nonexistent', { name: 'x' });

      expect(result).toBeNull();
    });

    it('only updates provided fields', () => {
      const row = makeRepoScenario();
      const store = new Map<string, RepoTestScenario>([['ts-1', row]]);
      repo = createMockRepo(store);
      service = new TestScenarioService(repo);

      const result = service.updateScenario('ts-1', {
        description: 'New description',
      });

      expect(result).not.toBeNull();
      expect(result!.description).toBe('New description');
      // name stays unchanged
      expect(result!.name).toBe('Login test');
    });
  });

  describe('listScenariosByModule', () => {
    it('lists scenarios for a module with parsed test_data', () => {
      const row1 = makeRepoScenario({
        id: 'ts-1',
        test_data_json: JSON.stringify({
          preconditions: ['A'],
          expected_results: ['B'],
        }),
      });
      const row2 = makeRepoScenario({
        id: 'ts-2',
        name: 'Logout test',
        test_data_json: JSON.stringify({
          preconditions: ['C'],
          expected_results: ['D'],
        }),
      });
      const store = new Map<string, RepoTestScenario>([
        ['ts-1', row1],
        ['ts-2', row2],
      ]);
      repo = createMockRepo(store);
      service = new TestScenarioService(repo);

      const results = service.listScenariosByModule('fm-1');

      expect(results).toHaveLength(2);
      expect(results[0].preconditions).toEqual(['A']);
      expect(results[1].preconditions).toEqual(['C']);
    });

    it('returns empty array when no scenarios exist', () => {
      const results = service.listScenariosByModule('fm-nonexistent');

      expect(results).toEqual([]);
    });

    it('handles malformed test_data_json in some rows gracefully', () => {
      const row1 = makeRepoScenario({
        id: 'ts-1',
        test_data_json: 'not json',
      });
      const row2 = makeRepoScenario({
        id: 'ts-2',
        test_data_json: JSON.stringify({ preconditions: ['X'], expected_results: ['Y'] }),
      });
      const store = new Map<string, RepoTestScenario>([
        ['ts-1', row1],
        ['ts-2', row2],
      ]);
      repo = createMockRepo(store);
      service = new TestScenarioService(repo);

      const results = service.listScenariosByModule('fm-1');

      expect(results).toHaveLength(2);
      expect(results[0].preconditions).toEqual([]);
      expect(results[0].expected_results).toEqual([]);
      expect(results[1].preconditions).toEqual(['X']);
      expect(results[1].expected_results).toEqual(['Y']);
    });
  });
});
