import type {
  BusinessVersion,
  BusinessVersionDetail,
  GitMetadata,
} from '../types/business-version.js';
import {
  BusinessVersionRepository,
  BusinessVersionRepositoryError,
  type BusinessVersionCopyResult,
} from '../database/repositories/business-version-repository.js';
import { ServiceError } from './service-error.js';

export interface CreateBusinessVersionInput {
  projectId: string;
  versionKey: string;
  name: string;
  createdBy: string;
  idempotencyKey: string;
  sourceVersionId?: string;
  git?: GitMetadata;
  deploymentRevisionId?: string;
}

export interface CopyBusinessVersionInput {
  sourceVersionId: string;
  versionKey: string;
  name: string;
  createdBy: string;
  idempotencyKey: string;
  git?: GitMetadata;
  deploymentRevisionId?: string;
}

export class BusinessVersionService {
  constructor(private readonly repository: BusinessVersionRepository) {}

  create(input: CreateBusinessVersionInput): { version: BusinessVersion; created: boolean } {
    try {
      if (input.sourceVersionId) {
        const source = this.repository.findById(input.sourceVersionId);
        if (!source || source.projectId !== input.projectId) {
          throw new BusinessVersionRepositoryError(
            'not_found',
            `Source business version ${input.sourceVersionId} was not found in project ${input.projectId}`
          );
        }
        return this.repository.copy({
          sourceVersionId: input.sourceVersionId,
          versionKey: input.versionKey,
          name: input.name,
          createdBy: input.createdBy,
          copyRequestId: input.idempotencyKey,
          ...(input.git ? { git: input.git } : {}),
          ...(input.deploymentRevisionId
            ? { deploymentRevisionId: input.deploymentRevisionId }
            : {}),
        });
      }
      return this.repository.create({
        projectId: input.projectId,
        versionKey: input.versionKey,
        name: input.name,
        createdBy: input.createdBy,
        requestId: input.idempotencyKey,
        ...(input.git ? { git: input.git } : {}),
        ...(input.deploymentRevisionId ? { deploymentRevisionId: input.deploymentRevisionId } : {}),
      });
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }

  list(projectId: string): BusinessVersion[] {
    return this.repository.listByProject(projectId);
  }

  get(versionId: string): BusinessVersionDetail {
    const detail = this.repository.findDetail(versionId);
    if (!detail) throw ServiceError.notFound(`Business version '${versionId}' not found`);
    return detail;
  }

  copy(input: CopyBusinessVersionInput): BusinessVersionCopyResult {
    try {
      return this.repository.copy({
        sourceVersionId: input.sourceVersionId,
        versionKey: input.versionKey,
        name: input.name,
        createdBy: input.createdBy,
        copyRequestId: input.idempotencyKey,
        ...(input.git ? { git: input.git } : {}),
        ...(input.deploymentRevisionId ? { deploymentRevisionId: input.deploymentRevisionId } : {}),
      });
    } catch (error) {
      throw mapRepositoryError(error);
    }
  }
}

function mapRepositoryError(error: unknown): Error {
  if (!(error instanceof BusinessVersionRepositoryError)) {
    return error instanceof Error
      ? error
      : ServiceError.internal('Business version operation failed');
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
