import fp from './fastify-plugin.js';
import type { FastifyError, FastifyInstance } from 'fastify';
import { DomainError, ServiceError } from '../../services/service-error.js';
import type { ApiProblem } from '../../contracts/semantic-control.js';
import {
  BusinessVersionRepositoryError,
  type BusinessVersionRejectionReason,
} from '../../database/repositories/business-version-repository.js';

const scenarioRejections: Record<BusinessVersionRejectionReason, { status: number; code: string }> =
  {
    scenario_payload_invalid: { status: 400, code: 'validation_error' },
    scenario_calls_invalid: { status: 400, code: 'validation_error' },
    scenario_call_invalid: { status: 400, code: 'validation_error' },
    scenario_condition_unsupported: { status: 500, code: 'internal_error' },
    scenario_repeat_unsupported: { status: 409, code: 'conflict' },
  };

function getStatusCode(error: FastifyError | Error): number {
  if (error instanceof BusinessVersionRepositoryError) {
    return error.reason ? scenarioRejections[error.reason].status : 500;
  }
  if (error instanceof DomainError) {
    return { not_found: 404, conflict: 409, validation_error: 400 }[error.kind];
  }
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    return error.statusCode;
  }

  return 500;
}

function toApiProblem(
  error: FastifyError | Error,
  correlationId: string,
  statusCode: number
): ApiProblem {
  const serviceError = error instanceof ServiceError ? error : undefined;
  const domainError = error instanceof DomainError ? error : undefined;
  const repositoryCode =
    error instanceof BusinessVersionRepositoryError
      ? error.reason
        ? scenarioRejections[error.reason].code
        : 'internal_error'
      : undefined;
  const code =
    repositoryCode ??
    domainError?.code ??
    serviceError?.code ??
    ('code' in error && typeof error.code === 'string' && error.code.startsWith('FST_')
      ? error.code
      : 'internal_error');
  return {
    code: code.toLowerCase(),
    message: error.message || 'Internal Server Error',
    retryable: statusCode === 429 || statusCode >= 500,
    correlationId,
    ...(domainError?.details
      ? { details: domainError.details }
      : serviceError?.details?.length
        ? { details: { errors: serviceError.details } }
        : {}),
  };
}

async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError | Error, request, reply) => {
    request.log.error(
      {
        err: error,
        request: {
          method: request.method,
          url: request.url,
        },
      },
      'AI E2E request error'
    );

    const statusCode = error instanceof ServiceError ? error.statusCode : getStatusCode(error);
    const correlationHeader = request.headers['x-correlation-id'];
    const correlationId = Array.isArray(correlationHeader)
      ? (correlationHeader[0] ?? request.id)
      : (correlationHeader ?? request.id);
    reply.status(statusCode).send(toApiProblem(error, correlationId, statusCode));
  });
}

export default fp(errorHandlerPlugin, {
  fastify: '5.x',
  name: 'error-handler',
});
