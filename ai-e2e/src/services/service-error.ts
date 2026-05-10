/**
 * ServiceError - Base error class for service-layer errors with HTTP status code mapping.
 *
 * This class provides a standard way to throw errors with HTTP status codes that the Fastify
 * error handler can map to HTTP responses. It includes factory methods for common error types
 * (NotFound, Conflict, Validation, Unauthorized, Forbidden, Internal).
 *
 * Use this instead of bare `throw new Error()` in services to ensure proper HTTP responses.
 */
export class ServiceError extends Error {
  public readonly details?: string[];

  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    details?: string[]
  ) {
    super(message);
    this.name = 'ServiceError';
    this.details = details;
  }

  static notFound(message: string): ServiceError {
    return new ServiceError(message, 404, 'NOT_FOUND');
  }

  static conflict(message: string): ServiceError {
    return new ServiceError(message, 409, 'CONFLICT');
  }

  static validation(message: string, details?: string[]): ServiceError {
    return new ServiceError(message, 400, 'VALIDATION_ERROR', details);
  }

  static unauthorized(message: string): ServiceError {
    return new ServiceError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message: string): ServiceError {
    return new ServiceError(message, 403, 'FORBIDDEN');
  }

  static internal(message: string): ServiceError {
    return new ServiceError(message, 500, 'INTERNAL_ERROR');
  }

  static unavailable(message: string): ServiceError {
    return new ServiceError(message, 503, 'SERVICE_UNAVAILABLE');
  }
}
