/**
 * Execution Routes (Mode 4)
 *
 * Routes for script execution, run history, AI diagnosis,
 * and human review approval/rejection.
 */
import { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import fp from '../plugins/fastify-plugin.js';
import { DatabaseManager } from '../../database/db.js';
import { ServiceError } from '../../services/service-error.js';
import type { ExecutorService, ExecutionResult } from '../../services/executor-service.js';
import type { AIDiagnosisService } from '../../services/ai-diagnosis-service.js';

interface ExecutionRouteOptions {
  executor?: ExecutorService;
  diagnosis?: AIDiagnosisService;
}

const routes: FastifyPluginAsyncTypebox<ExecutionRouteOptions> = async (fastify, options) => {
  const executorOverride = options.executor;
  const diagnosisOverride = options.diagnosis;

  function getExecutor(): ExecutorService {
    if (executorOverride) return executorOverride;
    throw ServiceError.internal('Executor service not configured');
  }

  function getDiagnosis(): AIDiagnosisService {
    if (diagnosisOverride) return diagnosisOverride;
    throw ServiceError.internal('Diagnosis service not configured');
  }

  function requireProject(projectId: string) {
    const db = DatabaseManager.getInstance();
    const project = db.getProjectRepo().findById(projectId);
    if (!project) {
      throw ServiceError.notFound(`Project '${projectId}' not found`);
    }
    return project;
  }

  // POST /run/:scriptId — execute a single script
  fastify.post(
    '/run/:scriptId',
    {
      schema: {
        description: 'Execute a single test script',
        tags: ['Execution'],
        params: Type.Object({
          id: Type.String({ description: 'Project ID' }),
          scriptId: Type.String({ description: 'Script ID to execute' }),
        }),
        body: Type.Object({
          timeout: Type.Optional(Type.Number({ description: 'Execution timeout in ms' })),
        }),
        response: {
          200: Type.Object({
            runId: Type.String(),
            status: Type.String(),
            exitCode: Type.Union([Type.Number(), Type.Null()]),
            signal: Type.Union([Type.String(), Type.Null()]),
            stdout: Type.String(),
            stderr: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId, scriptId } = request.params as { id: string; scriptId: string };
      requireProject(projectId);

      const body = request.body as { timeout?: number };
      const result: ExecutionResult = await getExecutor().executeScript(
        scriptId,
        body?.timeout ? { timeout: body.timeout } : undefined,
      );

      fastify.sseEmitter.emit({
        type: 'execution.started',
        data: { runId: result.runId, scriptId },
      });

      if (result.status === 'pass') {
        fastify.sseEmitter.emit({
          type: 'execution.completed',
          data: {
            run: {
              id: result.runId,
              script_id: scriptId,
              run_number: 1,
              status: 'pass',
              started_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
            },
          },
        });
      } else {
        fastify.sseEmitter.emit({
          type: 'execution.failed',
          data: { runId: result.runId, error: result.stderr },
        });
      }

      return reply.status(200).send(result);
    },
  );

  // POST /run-all — execute all scripts for the project
  fastify.post(
    '/run-all',
    {
      schema: {
        description: 'Execute all scripts for a project',
        tags: ['Execution'],
        response: {
          200: Type.Object({
            total: Type.Number(),
            succeeded: Type.Number(),
            failed: Type.Number(),
            results: Type.Array(Type.Object({
              script_id: Type.String(),
              runId: Type.Optional(Type.String()),
              status: Type.Optional(Type.String()),
              exitCode: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
              signal: Type.Optional(Type.Union([Type.String(), Type.Null()])),
              stdout: Type.Optional(Type.String()),
              stderr: Type.Optional(Type.String()),
              error: Type.Optional(Type.String()),
            })),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const scripts = collectProjectScripts(db, projectId);

      const executor = getExecutor();
      const results: Array<{
        script_id: string;
        runId?: string;
        status?: string;
        exitCode?: number | null;
        signal?: string | null;
        stdout?: string;
        stderr?: string;
        error?: string;
      }> = [];

      for (const script of scripts) {
        // executeScript() always resolves (never rejects) — it returns status
        // from the child process exit code. Only retry on infrastructure errors
        // (error/timeout), not on test assertion failures (fail).
        let result: Awaited<ReturnType<typeof executor.executeScript>>;
        try {
          result = await executor.executeScript(script.id);
          // Retry once on infrastructure-level failures (timeout, spawn error)
          if (result.status === 'error' || result.status === 'timeout') {
            result = await executor.executeScript(script.id);
          }
        } catch (error) {
          // Only thrown if script not found in DB — not a retryable scenario
          results.push({
            script_id: script.id,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        results.push({
          script_id: script.id,
          runId: result.runId,
          status: result.status,
          exitCode: result.exitCode,
          signal: result.signal,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }

      const failedCount = results.filter(r => r.error || (r.status && r.status !== 'pass')).length;
      const succeededCount = results.length - failedCount;

      return reply.status(200).send({
        total: results.length,
        succeeded: succeededCount,
        failed: failedCount,
        results,
      });
    },
  );

  // GET /runs — execution history list
  fastify.get(
    '/runs',
    {
      schema: {
        description: 'Get execution runs for a project',
        tags: ['Execution'],
        response: {
          200: Type.Object({
            runs: Type.Array(Type.Object({
              id: Type.String(),
              script_id: Type.String(),
              script_version: Type.Number(),
              status: Type.String(),
              started_at: Type.String(),
              completed_at: Type.Union([Type.String(), Type.Null()]),
              error_message: Type.Union([Type.String(), Type.Null()]),
              created_at: Type.String(),
            })),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const scripts = collectProjectScripts(db, projectId);
      const allRuns = scripts.flatMap(s => db.getExecutionRunRepo().findByScriptId(s.id));

      return reply.status(200).send({ runs: allRuns });
    },
  );

  // GET /runs/:runId — execution detail
  fastify.get(
    '/runs/:runId',
    {
      schema: {
        description: 'Get execution run detail',
        tags: ['Execution'],
        params: Type.Object({
          runId: Type.String({ description: 'Execution run ID' }),
        }),
        response: {
          200: Type.Object({
            id: Type.String(),
            script_id: Type.String(),
            script_version: Type.Number(),
            status: Type.String(),
            started_at: Type.String(),
            completed_at: Type.Union([Type.String(), Type.Null()]),
            error_message: Type.Union([Type.String(), Type.Null()]),
            created_at: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const { runId } = request.params as { runId: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const run = db.getExecutionRunRepo().findById(runId);
      if (!run) {
        throw ServiceError.notFound(`Execution run '${runId}' not found`);
      }

      return reply.status(200).send(run);
    },
  );

  // POST /runs/:runId/approve-fix — approve AI fix
  fastify.post(
    '/runs/:runId/approve-fix',
    {
      schema: {
        description: 'Approve an AI fix pending human review',
        tags: ['Execution'],
        params: Type.Object({
          runId: Type.String({ description: 'Execution run ID' }),
        }),
        response: {
          200: Type.Object({
            approved: Type.Boolean(),
            runId: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const { runId } = request.params as { runId: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const run = db.getExecutionRunRepo().findById(runId);
      if (!run) {
        throw ServiceError.notFound(`Execution run '${runId}' not found`);
      }

      // Find the pending review log and create an approved log entry
      const logs = db.getAIInterventionLogRepo().findByRunId(runId);
      const pendingLog = logs.find(l => l.action_taken === 'pending_human_review');
      if (pendingLog && pendingLog.modified_script_snapshot) {
        // Resolve the scenario ID from the script chain
        const script = db.getScriptRepo().findById(run.script_id);
        if (script) {
          db.getScriptRepo().createVersion(
            script.test_scenario_id,
            pendingLog.modified_script_snapshot,
            'human_edited',
          );
        }
      }

      // Log the approval
      db.getAIInterventionLogRepo().create({
        execution_run_id: runId,
        action_taken: 'human_approved',
        outcome: 'Fix approved by human reviewer',
      });

      fastify.sseEmitter.emit({
        type: 'ai.fix_applied',
        data: {
          runId,
          scriptId: run.script_id,
          diffStats: { linesChanged: 0, totalLines: 0 },
        },
      });

      return reply.status(200).send({ approved: true, runId });
    },
  );

  // POST /runs/:runId/reject-fix — reject AI fix
  fastify.post(
    '/runs/:runId/reject-fix',
    {
      schema: {
        description: 'Reject an AI fix pending human review',
        tags: ['Execution'],
        params: Type.Object({
          runId: Type.String({ description: 'Execution run ID' }),
        }),
        body: Type.Optional(Type.Object({
          reason: Type.Optional(Type.String({ description: 'Rejection reason' })),
        })),
        response: {
          200: Type.Object({
            rejected: Type.Boolean(),
            runId: Type.String(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const { runId } = request.params as { runId: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const run = db.getExecutionRunRepo().findById(runId);
      if (!run) {
        throw ServiceError.notFound(`Execution run '${runId}' not found`);
      }

      const body = request.body as { reason?: string } | undefined;

      db.getAIInterventionLogRepo().create({
        execution_run_id: runId,
        action_taken: 'human_rejected',
        outcome: body?.reason ?? 'Fix rejected by human reviewer',
      });

      return reply.status(200).send({ rejected: true, runId });
    },
  );

  // GET /diagnosis/:runId — AI diagnosis detail
  fastify.get(
    '/diagnosis/:runId',
    {
      schema: {
        description: 'Get AI diagnosis detail for a failed run',
        tags: ['Execution'],
        params: Type.Object({
          runId: Type.String({ description: 'Execution run ID' }),
        }),
        response: {
          200: Type.Object({
            runId: Type.String(),
            logs: Type.Array(Type.Object({
              id: Type.String(),
              diagnosis: Type.Union([Type.String(), Type.Null()]),
              action_taken: Type.Union([Type.String(), Type.Null()]),
              created_at: Type.String(),
            })),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id: projectId } = request.params as { id: string };
      const { runId } = request.params as { runId: string };
      requireProject(projectId);

      const db = DatabaseManager.getInstance();
      const run = db.getExecutionRunRepo().findById(runId);
      if (!run) {
        throw ServiceError.notFound(`Execution run '${runId}' not found`);
      }

      const logs = db.getAIInterventionLogRepo().findByRunId(runId);

      return reply.status(200).send({
        runId,
        logs: logs.map(l => ({
          id: l.id,
          diagnosis: l.diagnosis,
          action_taken: l.action_taken,
          created_at: l.created_at,
        })),
      });
    },
  );
};

/**
 * Walk the project → BM → FM → scenario → script chain
 * to collect all scripts belonging to a project.
 */
function collectProjectScripts(
  db: DatabaseManager,
  projectId: string,
): Array<{ id: string }> {
  const scripts: Array<{ id: string }> = [];
  const modules = db.getBusinessModuleRepo().findByProjectId(projectId);
  for (const mod of modules) {
    const funcModules = db.getFunctionalModuleRepo().findByBusinessModuleId(mod.id);
    for (const fm of funcModules) {
      const scenarios = db.getTestScenarioRepo().findByFunctionalModuleId(fm.id);
      for (const ts of scenarios) {
        const scenarioScripts = db.getScriptRepo().findByScenarioId(ts.id);
        scripts.push(...scenarioScripts);
      }
    }
  }
  return scripts;
}

export default fp(routes, { fastify: '5.x', name: 'execution-routes', encapsulate: true });
