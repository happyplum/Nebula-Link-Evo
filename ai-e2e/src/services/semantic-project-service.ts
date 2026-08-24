import {
  SemanticProjectRepository,
  SemanticProjectRepositoryError,
  type CreateSemanticProjectWorkspaceInput,
} from '../database/repositories/semantic-project-repository.js';
import { ServiceError } from './service-error.js';

export class SemanticProjectService {
  constructor(private readonly repository: SemanticProjectRepository) {}

  createWorkspace(input: CreateSemanticProjectWorkspaceInput) {
    try {
      return this.repository.createWorkspace(input);
    } catch (error) {
      throw mapError(error);
    }
  }

  list() {
    return this.repository.list();
  }

  get(id: string) {
    const project = this.repository.findById(id);
    if (!project) throw ServiceError.notFound(`Project '${id}' not found`);
    return project;
  }
}

function mapError(error: unknown): Error {
  if (!(error instanceof SemanticProjectRepositoryError)) {
    return error instanceof Error ? error : ServiceError.internal('Project operation failed');
  }
  switch (error.code) {
    case 'not_found':
      return ServiceError.notFound(error.message);
    case 'conflict':
      return ServiceError.conflict(error.message);
    case 'validation_failed':
      return ServiceError.validation(error.message);
  }
}
