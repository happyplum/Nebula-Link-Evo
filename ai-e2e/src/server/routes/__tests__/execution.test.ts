import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { DatabaseManager } from '../../../database/db.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import sseEmitterPlugin from '../../plugins/sse-emitter.js';
import executionRoutes from '../execution.js';
import type { ExecutorService } from '../../../services/executor-service.js';
import type { AIDiagnosisService } from '../../../services/ai-diagnosis-service.js';

const apps = new Set<FastifyInstance>();

function createApp(): FastifyInstance {
  const app = Fastify()
    .withTypeProvider<TypeBoxTypeProvider>();
  app.register(errorHandlerPlugin);
  app.register(sseEmitterPlugin);
  apps.add(app);
  return app;
}

beforeEach(() => {
  DatabaseManager.resetInstance();
});

afterEach(async () => {
  await Promise.all(Array.from(apps, async app => app.close()));
  apps.clear();
  DatabaseManager.resetInstance();
});

function seedProject(db: DatabaseManager, status = 'ready'): string {
  db.getProjectRepo().create({ name: 'Test Project', target_base_url: 'http://example.com', status });
  const projects = db.getProjectRepo().findAll();
  return projects[0].id;
}

function seedScript(db: DatabaseManager): string {
  const projects = db.getProjectRepo().findAll();
  const projectId = projects[0].id;
  // Seed the full chain: BM -> FM -> Scenario -> Script
  const bm = db.getBusinessModuleRepo().create({ project_id: projectId, name: 'BM' });
  const fm = db.getFunctionalModuleRepo().create({ business_module_id: bm.id, name: 'FM', description: '' });
  const ts = db.getTestScenarioRepo().create({ functional_module_id: fm.id, name: 'TS', description: '' });
  const script = db.getScriptRepo().create({ test_scenario_id: ts.id, content: 'test("example", () => {});' });
  return script.id;
}

function makeMockExecutor(overrides?: Partial<ExecutorService>): ExecutorService {
  return {
    executeScript: vi.fn(),
    cancelExecution: vi.fn(),
    getExecutionResult: vi.fn(),
    getArtifacts: vi.fn(),
    ...overrides,
  } as unknown as ExecutorService;
}

function makeMockDiagnosis(overrides?: Partial<AIDiagnosisService>): AIDiagnosisService {
  return {
    diagnoseFailure: vi.fn(),
    attemptAutoFix: vi.fn(),
    requestHumanReview: vi.fn(),
    getDiagnosisHistory: vi.fn(),
    ...overrides,
  } as unknown as AIDiagnosisService;
}

describe('Execution routes', () => {
  describe('POST /run/:scriptId', () => {
    it('executes a script and returns the result', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const mockResult = {
        runId: 'run-1',
        status: 'pass' as const,
        exitCode: 0,
        signal: null,
        stdout: 'ok',
        stderr: '',
      };
      const executor = makeMockExecutor({ executeScript: vi.fn().mockResolvedValue(mockResult) });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor,
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/run/${scriptId}`,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.runId).toBe('run-1');
      expect(body.status).toBe('pass');
      expect(executor.executeScript).toHaveBeenCalledWith(scriptId, undefined);
    });

    it('passes options body to executor', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const mockResult = { runId: 'run-2', status: 'pass' as const, exitCode: 0, signal: null, stdout: '', stderr: '' };
      const executor = makeMockExecutor({ executeScript: vi.fn().mockResolvedValue(mockResult) });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor,
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/run/${scriptId}`,
        payload: { timeout: 60000 },
      });

      expect(response.statusCode).toBe(200);
      expect(executor.executeScript).toHaveBeenCalledWith(scriptId, { timeout: 60000 });
    });

    it('returns 404 for non-existent project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/projects/nonexistent/execution/run/some-script',
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /run-all', () => {
    it('executes all scripts for a project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      seedScript(db);
      seedScript(db);

      const mockResult = { runId: 'run-x', status: 'pass' as const, exitCode: 0, signal: null, stdout: '', stderr: '' };
      const executor = makeMockExecutor({ executeScript: vi.fn().mockResolvedValue(mockResult) });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor,
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/run-all`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.results).toHaveLength(2);
      expect(body.total).toBe(2);
      expect(body.succeeded).toBe(2);
      expect(body.failed).toBe(0);
      expect(body.results[0]).toMatchObject({
        script_id: expect.any(String),
        runId: 'run-x',
        status: 'pass',
      });
    });

    it('retries on infrastructure error status and reports partial results', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      seedScript(db);
      seedScript(db);

      // First script: error on first run, still error on retry → reported as error
      // Second script: error on first run, pass on retry → reported as pass
      // Note: executeScript() always resolves; it never rejects.
      // Infrastructure errors produce { status: 'error' }, not rejections.
      const executeScript = vi.fn()
        .mockResolvedValueOnce({
          runId: 'run-err-1',
          status: 'error' as const,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: 'spawn error',
        })
        .mockResolvedValueOnce({
          runId: 'run-err-1-retry',
          status: 'error' as const,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: 'spawn error again',
        })
        .mockResolvedValueOnce({
          runId: 'run-err-2',
          status: 'error' as const,
          exitCode: null,
          signal: null,
          stdout: '',
          stderr: 'spawn error',
        })
        .mockResolvedValueOnce({
          runId: 'run-ok',
          status: 'pass' as const,
          exitCode: 0,
          signal: null,
          stdout: 'ok',
          stderr: '',
        });
      const executor = makeMockExecutor({ executeScript });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor,
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/run-all`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      // First script: error→error (retried once, still error → reported as failed)
      // Second script: error→pass (retried once, succeeded)
      expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      expect(executeScript).toHaveBeenCalledTimes(4);
    });

    it('retries on timeout status but not on fail', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      seedScript(db);
      seedScript(db);

      // First script: timeout → retry → pass
      // Second script: fail → NO retry → reported as fail
      const executeScript = vi.fn()
        .mockResolvedValueOnce({
          runId: 'run-timeout',
          status: 'timeout' as const,
          exitCode: null,
          signal: 'SIGTERM',
          stdout: '',
          stderr: '',
        })
        .mockResolvedValueOnce({
          runId: 'run-ok',
          status: 'pass' as const,
          exitCode: 0,
          signal: null,
          stdout: 'ok',
          stderr: '',
        })
        .mockResolvedValueOnce({
          runId: 'run-fail',
          status: 'fail' as const,
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: 'assertion failed',
        });
      const executor = makeMockExecutor({ executeScript });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor,
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/run-all`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
      // timeout retried once (2 calls) + fail NOT retried (1 call) = 3 total
      expect(executeScript).toHaveBeenCalledTimes(3);
    });
  });

  describe('GET /runs', () => {
    it('returns execution runs for a project', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const run = db.getExecutionRunRepo().create({ script_id: scriptId, status: 'pass' });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/execution/runs`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].id).toBe(run.id);
    });
  });

  describe('GET /runs/:runId', () => {
    it('returns a specific execution run', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const run = db.getExecutionRunRepo().create({ script_id: scriptId, status: 'running' });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/execution/runs/${run.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(run.id);
      expect(body.status).toBe('running');
    });

    it('returns 404 for non-existent run', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/execution/runs/nonexistent`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /runs/:runId/approve-fix', () => {
    it('approves a pending human review fix', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const run = db.getExecutionRunRepo().create({ script_id: scriptId, status: 'fail' });
      db.getAIInterventionLogRepo().create({
        execution_run_id: run.id,
        action_taken: 'pending_human_review',
        diagnosis: 'selector broken',
        modified_script_snapshot: 'fixed content',
      });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/runs/${run.id}/approve-fix`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.approved).toBe(true);
      expect(body.runId).toBe(run.id);
    });
  });

  describe('POST /runs/:runId/reject-fix', () => {
    it('rejects a pending human review fix', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const run = db.getExecutionRunRepo().create({ script_id: scriptId, status: 'fail' });
      db.getAIInterventionLogRepo().create({
        execution_run_id: run.id,
        action_taken: 'pending_human_review',
        diagnosis: 'selector broken',
      });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'POST',
        url: `/api/projects/${projectId}/execution/runs/${run.id}/reject-fix`,
        payload: { reason: 'fix is wrong' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.rejected).toBe(true);
      expect(body.runId).toBe(run.id);
    });
  });

  describe('GET /diagnosis/:runId', () => {
    it('returns diagnosis history for a run', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');
      const scriptId = seedScript(db);

      const run = db.getExecutionRunRepo().create({ script_id: scriptId, status: 'fail' });
      db.getAIInterventionLogRepo().create({
        execution_run_id: run.id,
        diagnosis: 'The selector #old-btn was not found',
        action_taken: 'diagnose_only',
      });

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/execution/diagnosis/${run.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.runId).toBe(run.id);
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].diagnosis).toBe('The selector #old-btn was not found');
    });

    it('returns 404 for non-existent run', async () => {
      const db = DatabaseManager.getInstance();
      db.init(':memory:');
      const projectId = seedProject(db, 'running');

      const app = createApp();
      app.register(executionRoutes, {
        prefix: '/api/projects/:id/execution',
        executor: makeMockExecutor(),
        diagnosis: makeMockDiagnosis(),
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/${projectId}/execution/diagnosis/nonexistent`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
