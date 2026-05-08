import fp from './fastify-plugin.js';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ServiceError } from '../../services/service-error.js';
import type { ErrorResponse } from '../../types/api.js';

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

    if (error instanceof ServiceError) {
      reply.status(error.statusCode).send(toErrorResponse(error.code, error.message, error.details));
      return;
    }

    const statusCode = getStatusCode(error);
    const message = error.message || 'Internal Server Error';
    reply.status(statusCode).send(toErrorResponse('INTERNAL_ERROR', message));
  });

  fastify.setNotFoundHandler((request, reply) => {
    reply
      .status(404)
      .send(toErrorResponse('NOT_FOUND', `Route ${request.method}:${request.url} not found`));
  });
}

export default fp(errorHandlerPlugin, {
  fastify: '5.x',
  name: 'error-handler',
});
