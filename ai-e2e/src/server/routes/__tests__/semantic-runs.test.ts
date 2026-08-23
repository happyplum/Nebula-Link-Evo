import Fastify, { type FastifyInstance } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SemanticRunService } from '../../../services/semantic-run-service.js';
import errorHandlerPlugin from '../../plugins/error-handler.js';
import semanticRunRoutes from '../semantic-runs.js';

const HASH = 'a'.repeat(64);

describe('semantic run routes', () => {
  let app: FastifyInstance;
  const service = {
    create: vi.fn(() => ({
      id: 'run-1',
      browserJobId: 'browser-job-1',
      lifecycle: 'ready',
      stateVersion: 2,
      created: true,
      admission: 'ready',
    })),
    command: vi.fn(() => ({ lifecycle: 'running', stateVersion: 3, replayed: false })),
    closeBrowser: vi.fn(() => ({ created: true })),
    startTodo: vi.fn(() => ({ pageTaskId: 'page-task-1', taskNo: 1 })),
    completeTodoAttempt: vi.fn(() => ({
      attemptId: 'attempt-1',
      todoState: 'passed',
      runLifecycle: 'completed',
    })),
    resumeTodo: vi.fn(() => ({ state: 'ready' })),
    answerDecision: vi.fn(() => ({ decisionStatus: 'applied', todoState: 'ready' })),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    app.register(errorHandlerPlugin);
    app.register(semanticRunRoutes, {
      prefix: '/api/v1',
      service: service as unknown as SemanticRunService,
    });
    await app.ready();
  });

  afterEach(async () => app.close());

  it('creates an idempotent formal run from the project route', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/projects/project-1/runs',
      headers: { 'idempotency-key': 'client-run-1' },
      payload: {
        schema: 'nebula.ai-e2e.create-run/1.0',
        businessVersionId: 'version-1',
        scenarioRevisionId: 'scenario-revision-1',
        deploymentRevisionId: 'deployment-revision-1',
        inputs: { account: 'fixture' },
        secretRefs: { password: 'vault://e2e/password' },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      data: { id: 'run-1', admission: 'ready' },
      meta: { stateVersion: 2 },
    });
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        clientRunId: 'client-run-1',
        secretRefs: { password: 'vault://e2e/password' },
      })
    );
  });

  it('requires an optimistic state version and queues explicit browser close', async () => {
    const command = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/commands',
      headers: { 'idempotency-key': 'command-1', 'if-match': 'W/"2"' },
      payload: {
        schema: 'nebula.ai-e2e.run-command/1.0',
        action: 'start',
        createdBy: 'operator',
      },
    });
    const close = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/commands',
      headers: { 'idempotency-key': 'close-1', 'if-match': '3' },
      payload: {
        schema: 'nebula.ai-e2e.run-command/1.0',
        action: 'close_browser',
        createdBy: 'operator',
      },
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/commands',
      headers: { 'idempotency-key': 'command-invalid', 'if-match': 'invalid' },
      payload: {
        schema: 'nebula.ai-e2e.run-command/1.0',
        action: 'pause',
        createdBy: 'operator',
      },
    });

    expect(command.statusCode).toBe(200);
    expect(service.command).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', action: 'start', expectedStateVersion: 2 })
    );
    expect(close.statusCode).toBe(202);
    expect(service.closeBrowser).toHaveBeenCalledWith('close-1', 'run-1', 'operator');
    expect(invalid.statusCode).toBe(400);
  });

  it('keeps run identity on worker TODO, attempt, recovery and decision calls', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/todos/todo-1/start',
      payload: {
        browserSessionId: 'session-1',
        tabId: 'tab-1',
        browserLeaseRefHash: HASH,
        toolPolicyHash: HASH,
        taskPayloadSha256: HASH,
        requiredAuthContext: { kind: 'anonymous' },
        sideEffectAuthorization: { result: 'auto_allowed' },
        budget: { maxToolCalls: 20 },
      },
    });
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/todos/todo-1/attempts',
      payload: {
        pageTaskId: 'page-task-1',
        result: 'succeeded',
        reasonClass: 'accepted',
        agentTaskId: 'agent-1',
        startedAt: new Date().toISOString(),
      },
    });
    const resume = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/todos/todo-1/resume',
    });
    const decision = await app.inject({
      method: 'POST',
      url: '/api/v1/runs/run-1/decisions/decision-1/answer',
      payload: { answerKey: 'resume', reason: '证据确认', answeredBy: 'operator' },
    });

    expect(start.statusCode).toBe(201);
    expect(attempt.statusCode).toBe(201);
    expect(resume.statusCode).toBe(200);
    expect(decision.statusCode).toBe(200);
    expect(service.startTodo).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', todoId: 'todo-1' })
    );
    expect(service.completeTodoAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', todoId: 'todo-1' })
    );
    expect(service.resumeTodo).toHaveBeenCalledWith('run-1', 'todo-1');
    expect(service.answerDecision).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', decisionId: 'decision-1' })
    );
  });
});
