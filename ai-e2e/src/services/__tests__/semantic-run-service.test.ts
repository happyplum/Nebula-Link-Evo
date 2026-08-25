import { describe, expect, it, vi } from 'vitest';
import type { SemanticRunControlRepository } from '../../database/repositories/semantic-run-control-repository.js';
import { SemanticRunService } from '../semantic-run-service.js';
import { ServiceError } from '../service-error.js';

function createRepository() {
  return {
    createFormalRun: vi.fn(() => ({ runId: 'run-1' })),
    command: vi.fn(() => ({ lifecycle: 'running', stateVersion: 2, replayed: false })),
    enqueueCloseBrowser: vi.fn(() => ({ created: true })),
    startTodo: vi.fn(() => ({ pageTaskId: 'page-task-1', taskNo: 1 })),
    completeTodoAttempt: vi.fn(() => ({ state: 'succeeded' })),
    resumeInterruptedTodo: vi.fn(() => ({ state: 'ready' as const })),
    answerDecision: vi.fn(() => ({ state: 'ready' })),
  };
}

describe('SemanticRunService', () => {
  it('delegates every formal Run control operation without rewriting its durable result', () => {
    const repository = createRepository();
    const service = new SemanticRunService(
      repository as unknown as SemanticRunControlRepository
    );
    const createInput = {
      projectId: 'project-1',
      businessVersionId: 'version-1',
      clientRunId: 'client-run-1',
      scenarioRevisionId: 'scenario-revision-1',
      deploymentRevisionId: 'deployment-revision-1',
      inputs: {},
    };
    const commandInput = {
      commandId: 'command-1',
      runId: 'run-1',
      action: 'start' as const,
      expectedStateVersion: 1,
      createdBy: 'tester',
    };
    const todoInput = {
      runId: 'run-1',
      todoId: 'todo-1',
      browserSessionId: 'session-1',
      tabId: 'tab-1',
      browserLeaseRefHash: 'lease-hash',
      toolPolicyHash: 'policy-hash',
      taskPayloadSha256: 'a'.repeat(64),
      requiredAuthContext: {},
      sideEffectAuthorization: {},
      budget: {},
    };
    const completionInput = {
      runId: 'run-1',
      todoId: 'todo-1',
      pageTaskId: 'page-task-1',
      result: 'succeeded' as const,
      reasonClass: 'verified',
      agentTaskId: 'agent-task-1',
      startedAt: '2026-08-25T00:00:00.000Z',
    };
    const decisionInput = {
      runId: 'run-1',
      decisionId: 'decision-1',
      answerKey: 'resume',
      reason: 'verified',
      answeredBy: 'tester',
    };

    expect(service.create(createInput)).toEqual({ runId: 'run-1' });
    expect(service.command(commandInput)).toMatchObject({ lifecycle: 'running' });
    expect(service.closeBrowser('close-1', 'run-1', 'tester')).toEqual({ created: true });
    expect(service.startTodo(todoInput)).toEqual({ pageTaskId: 'page-task-1', taskNo: 1 });
    expect(service.completeTodoAttempt(completionInput)).toEqual({ state: 'succeeded' });
    expect(service.resumeTodo('run-1', 'todo-1')).toEqual({ state: 'ready' });
    expect(service.answerDecision(decisionInput)).toEqual({ state: 'ready' });

    expect(repository.createFormalRun).toHaveBeenCalledWith(createInput);
    expect(repository.command).toHaveBeenCalledWith(commandInput);
    expect(repository.enqueueCloseBrowser).toHaveBeenCalledWith('close-1', 'run-1', 'tester');
    expect(repository.startTodo).toHaveBeenCalledWith(todoInput);
    expect(repository.completeTodoAttempt).toHaveBeenCalledWith(completionInput);
    expect(repository.resumeInterruptedTodo).toHaveBeenCalledWith('run-1', 'todo-1');
    expect(repository.answerDecision).toHaveBeenCalledWith(decisionInput);
  });

  it('turns a repository state-version conflict into the public conflict error', () => {
    const repository = createRepository();
    repository.command.mockReturnValue({
      lifecycle: 'running',
      stateVersion: 4,
      replayed: false,
      conflict: { expectedStateVersion: 2, actualStateVersion: 4 },
    });
    const service = new SemanticRunService(
      repository as unknown as SemanticRunControlRepository
    );

    expect(() =>
      service.command({
        commandId: 'command-conflict',
        runId: 'run-1',
        action: 'pause',
        expectedStateVersion: 2,
        createdBy: 'tester',
      })
    ).toThrowError(expect.objectContaining({ statusCode: 409, code: 'CONFLICT' }));
  });

  it.each([
    ['run not found', 404, 'NOT_FOUND'],
    ['invalid verification hash', 400, 'VALIDATION_ERROR'],
    ['run lifecycle transition rejected', 409, 'CONFLICT'],
    ['database unavailable', 500, 'INTERNAL_ERROR'],
  ])('maps repository error "%s" to the stable service contract', (message, statusCode, code) => {
    const repository = createRepository();
    repository.createFormalRun.mockImplementation(() => {
      throw new Error(message);
    });
    const service = new SemanticRunService(
      repository as unknown as SemanticRunControlRepository
    );

    expect(() => service.create({} as never)).toThrowError(
      expect.objectContaining({ statusCode, code, message })
    );
  });

  it('preserves an existing ServiceError without changing its status or details', () => {
    const repository = createRepository();
    const expected = ServiceError.forbidden('grant revoked');
    repository.createFormalRun.mockImplementation(() => {
      throw expected;
    });
    const service = new SemanticRunService(
      repository as unknown as SemanticRunControlRepository
    );

    expect(() => service.create({} as never)).toThrow(expected);
  });
});
