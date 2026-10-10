import type {
  CompleteTodoAttemptInput,
  CreateFormalRunInput,
  SemanticRunControlRepository,
  StartTodoInput,
} from '../database/repositories/semantic-run-control-repository.js';
import { DomainError } from './service-error.js';

export class SemanticRunService {
  constructor(private readonly runs: SemanticRunControlRepository) {}

  create(input: CreateFormalRunInput) {
    return this.runs.createFormalRun(input);
  }

  command(input: {
    commandId: string;
    runId: string;
    action: 'start' | 'pause' | 'resume' | 'cancel';
    expectedStateVersion: number;
    reason?: string;
    createdBy: string;
  }) {
    const result = this.runs.command(input);
    if (result.conflict) {
      throw new DomainError(
        'conflict',
        `Run state version conflict; expected=${result.conflict.expectedStateVersion}, actual=${result.conflict.actualStateVersion}`
      );
    }
    return result;
  }

  closeBrowser(commandId: string, runId: string, createdBy: string) {
    return this.runs.enqueueCloseBrowser(commandId, runId, createdBy);
  }

  startTodo(input: StartTodoInput) {
    return this.runs.startTodo(input);
  }

  completeTodoAttempt(input: CompleteTodoAttemptInput) {
    return this.runs.completeTodoAttempt(input);
  }

  resumeTodo(runId: string, todoId: string) {
    return this.runs.resumeInterruptedTodo(runId, todoId);
  }

  answerDecision(input: {
    runId: string;
    decisionId: string;
    answerKey: string;
    reason: string;
    answeredBy: string;
  }) {
    return this.runs.answerDecision(input);
  }
}
