import type {
  CompleteTodoAttemptInput,
  CreateFormalRunInput,
  SemanticRunControlRepository,
  StartTodoInput,
} from '../database/repositories/semantic-run-control-repository.js';
import { ServiceError } from './service-error.js';

export class SemanticRunService {
  constructor(private readonly runs: SemanticRunControlRepository) {}

  create(input: CreateFormalRunInput) {
    return this.execute(() => this.runs.createFormalRun(input));
  }

  command(input: {
    commandId: string;
    runId: string;
    action: 'start' | 'pause' | 'resume' | 'cancel';
    expectedStateVersion: number;
    reason?: string;
    createdBy: string;
  }) {
    const result = this.execute(() => this.runs.command(input));
    if (result.conflict) {
      throw ServiceError.conflict(
        `Run state version conflict; expected=${result.conflict.expectedStateVersion}, actual=${result.conflict.actualStateVersion}`
      );
    }
    return result;
  }

  closeBrowser(commandId: string, runId: string, createdBy: string) {
    return this.execute(() => this.runs.enqueueCloseBrowser(commandId, runId, createdBy));
  }

  startTodo(input: StartTodoInput) {
    return this.execute(() => this.runs.startTodo(input));
  }

  completeTodoAttempt(input: CompleteTodoAttemptInput) {
    return this.execute(() => this.runs.completeTodoAttempt(input));
  }

  resumeTodo(runId: string, todoId: string) {
    return this.execute(() => this.runs.resumeInterruptedTodo(runId, todoId));
  }

  answerDecision(input: {
    runId: string;
    decisionId: string;
    answerKey: string;
    reason: string;
    answeredBy: string;
  }) {
    return this.execute(() => this.runs.answerDecision(input));
  }

  private execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      throw mapRunError(error);
    }
  }
}

function mapRunError(error: unknown): Error {
  if (error instanceof ServiceError) return error;
  const message = error instanceof Error ? error.message : 'Semantic run operation failed';
  if (/not found|does not belong/i.test(message)) return ServiceError.notFound(message);
  if (
    /state|lifecycle|running|ready|paused|decision|conflict|reused|active|owns|resume|transition/i.test(
      message
    )
  ) {
    return ServiceError.conflict(message);
  }
  if (/required|must|invalid|verified|verification|secret|sha-256|allowed|acyclic/i.test(message)) {
    return ServiceError.validation(message);
  }
  return ServiceError.internal(message);
}
