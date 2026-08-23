import fp from './fastify-plugin.js';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ServiceError } from '../../services/service-error.js';
import type { ErrorResponse } from '../../types/api.js';
import type { ApiProblem } from '../../types/semantic-control.js';

function toErrorResponse(code: string, message: string, details?: string[]): ErrorResponse {
  if (details && details.length > 0) {
    return {
      error: {
        code,
        message,
        details,
      },
    };
  }

  return {
    error: {
      code,
      message,
    },
  };
}

function getStatusCode(error: FastifyError | Error): number {
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
  const code = serviceError?.code ?? ('code' in error && error.code ? String(error.code) : 'internal_error');
  return {
    code: code.toLowerCase(),
    message: error.message || 'Internal Server Error',
    retryable: statusCode === 429 || statusCode >= 500,
    correlationId,
    ...(serviceError?.details?.length
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
    if (request.url.startsWith('/api/v1')) {
      const correlationHeader = request.headers['x-correlation-id'];
      const correlationId = Array.isArray(correlationHeader)
        ? correlationHeader[0] ?? request.id
        : correlationHeader ?? request.id;
      reply.status(statusCode).send(toApiProblem(error, correlationId, statusCode));
      return;
    }

    if (error instanceof ServiceError) {
      reply.status(error.statusCode).send(toErrorResponse(error.code, error.message, error.details));
      return;
    }

    const message = error.message || 'Internal Server Error';
    reply.status(statusCode).send(toErrorResponse('INTERNAL_ERROR', message));
  });

}

export default fp(errorHandlerPlugin, {
  fastify: '5.x',
  name: 'error-handler',
});
