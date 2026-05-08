import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { ExecutorService, ExecutionResult } from '../executor-service.js';
import type { ScriptRepository, Script } from '../../database/repositories/script-repository.js';
import type { ExecutionRunRepository, ExecutionRun } from '../../database/repositories/execution-run-repository.js';

// ---------- Mocks ----------

const mockChildProcess = () => {
  const cp = new EventEmitter() as ChildProcess & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
  };
  cp.stdout = new EventEmitter();
  cp.stderr = new EventEmitter();
  cp.kill = vi.fn();
  cp.killed = false;
  return cp;
};

let cpInstance: ReturnType<typeof mockChildProcess>;

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    cpInstance = mockChildProcess();
    return cpInstance;
  }),
}));

vi.mock('node:fs', () => ({
  ...vi.importActual('node:fs'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(() => []),
}));

vi.mock('node:path', async () => {
  const actual = await vi.importActual('node:path');
  return { ...actual, join: vi.fn((...args: string[]) => args.join('/')) };
});

// ---------- Repository mocks ----------

function createMockScriptRepo(): ScriptRepository {
  const script: Script = {
    id: 'script-1',
    test_scenario_id: 'scenario-1',
    version: 2,
    content: 'import { test } from "playwright"; test("example", async ({ page }) => { await page.click("#btn"); });',
    language: 'ts',
    generated_by: 'ai_generated',
    status: 'edited',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  return {
    findById: vi.fn(() => script),
    findLatestByScenarioId: vi.fn(() => script),
    create: vi.fn(),
    createVersion: vi.fn(),
    findByScenarioId: vi.fn(() => [script]),
    findByStatus: vi.fn(() => []),
    delete: vi.fn(),
  } as unknown as ScriptRepository;
}

function createMockRunRepo(): ExecutionRunRepository {
  const runs: ExecutionRun[] = [];
  return {
    create: vi.fn((params) => {
      const run: ExecutionRun = {
        id: 'run-' + runs.length,
        script_id: params.script_id,
        script_version: params.script_version ?? 1,
        started_at: new Date().toISOString(),
        completed_at: null,
        status: params.status ?? 'running',
        logs: params.logs ?? null,
        screenshot_paths_json: params.screenshot_paths_json ?? null,
        error_message: params.error_message ?? null,
        created_at: new Date().toISOString(),
      };
      runs.push(run);
      return run;
    }),
    findById: vi.fn((id: string) => runs.find((r) => r.id === id) ?? null),
    findByScriptId: vi.fn(() => runs),
    findLatest: vi.fn(() => runs[runs.length - 1] ?? null),
    update: vi.fn((id, params) => {
      const run = runs.find((r) => r.id === id);
      if (!run) return null;
      Object.assign(run, params);
      return run;
    }),
    delete: vi.fn(),
  } as unknown as ExecutionRunRepository;
}

// ---------- Import after mocks ----------

const { spawn } = await import('node:child_process');
const { ExecutorService: ES } = await import('../executor-service.js');

// ---------- Tests ----------

describe('ExecutorService', () => {
  let service: ExecutorService;
  let scriptRepo: ScriptRepository;
  let runRepo: ExecutionRunRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    scriptRepo = createMockScriptRepo();
    runRepo = createMockRunRepo();
    service = new ES(scriptRepo, runRepo);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===== executeScript =====

  describe('executeScript', () => {
    it('should spawn a child process and return a passing result on exit code 0', async () => {
      const resultPromise = service.executeScript('script-1');

      // Simulate stdout + exit
      cpInstance.stdout.emit('data', Buffer.from('Test passed\n'));
      cpInstance.stderr.emit('data', Buffer.from(''));
      cpInstance.emit('exit', 0, null);

      const result = await resultPromise;

      expect(result.status).toBe('pass');
      expect(spawn).toHaveBeenCalled();
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ script_id: 'script-1', status: 'running' }),
      );
      expect(runRepo.update).toHaveBeenCalled();
    });

    it('should return fail status on exit code 1', async () => {
      const resultPromise = service.executeScript('script-1');

      cpInstance.stdout.emit('data', Buffer.from('Assertion failed\n'));
      cpInstance.stderr.emit('data', Buffer.from('Error: expected true\n'));
      cpInstance.emit('exit', 1, null);

      const result = await resultPromise;
      expect(result.status).toBe('fail');
    });

    it('should return error status on exit code 2', async () => {
      const resultPromise = service.executeScript('script-1');

      cpInstance.emit('exit', 2, null);

      const result = await resultPromise;
      expect(result.status).toBe('error');
    });

    it('should return timeout status when process is killed after timeout', async () => {
      // Override spawn to trigger kill behavior
      const mockedSpawn = vi.mocked(spawn);
      const timeoutCp = mockChildProcess();
      mockedSpawn.mockReturnValueOnce(timeoutCp);

      // Use a very short timeout for testing
      const resultPromise = service.executeScript('script-1', { timeout: 50 });

      // Simulate the process being killed (null exit code + signal)
      // We need to emit exit after the timeout fires internally
      setTimeout(() => {
        timeoutCp.emit('exit', null, 'SIGTERM');
      }, 100);

      const result = await resultPromise;
      expect(result.status).toBe('timeout');
      expect(timeoutCp.kill).toHaveBeenCalled();
    });

    it('should throw if script not found', () => {
      (scriptRepo.findById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      expect(() => service.executeScript('nonexistent')).toThrow(/not found/i);
    });
  });

  // ===== getExecutionResult =====

  describe('getExecutionResult', () => {
    it('should return the execution run from repository', () => {
      const mockRun: ExecutionRun = {
        id: 'run-0',
        script_id: 'script-1',
        script_version: 2,
        started_at: '2025-01-01T00:00:00.000Z',
        completed_at: '2025-01-01T00:01:00.000Z',
        status: 'pass',
        logs: 'stdout here',
        screenshot_paths_json: null,
        error_message: null,
        created_at: '2025-01-01T00:00:00.000Z',
      };
      (runRepo.findById as ReturnType<typeof vi.fn>).mockReturnValueOnce(mockRun);

      const result = service.getExecutionResult('run-0');
      expect(result).toEqual(mockRun);
    });

    it('should return null if run not found', () => {
      (runRepo.findById as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
      expect(service.getExecutionResult('nope')).toBeNull();
    });
  });

  // ===== cancelExecution =====

  describe('cancelExecution', () => {
    it('should kill the running process and update status', async () => {
      // Start execution
      const resultPromise = service.executeScript('script-1');

      // Cancel before exit
      service.cancelExecution('run-0');

      // Let the process emit exit
      cpInstance.emit('exit', null, 'SIGTERM');

      const result = await resultPromise;
      expect(cpInstance.kill).toHaveBeenCalled();
    });

    it('should return false if no active process for runId', () => {
      expect(service.cancelExecution('nonexistent')).toBe(false);
    });
  });

  // ===== getArtifacts =====

  describe('getArtifacts', () => {
    it('should return artifact paths for a run', () => {
      const artifacts = service.getArtifacts('run-123');
      // Returns object with standard artifact directories
      expect(artifacts).toHaveProperty('baseDir');
      expect(artifacts).toHaveProperty('screenshots');
      expect(artifacts).toHaveProperty('traces');
      expect(artifacts).toHaveProperty('logs');
    });
  });
});
