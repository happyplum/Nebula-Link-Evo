/**
 * HTTP 错误基类
 * 所有自定义 HTTP 错误的基类
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    code: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON() {
    return {
      success: false,
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details && { details: this.details }),
    };
  }
}

// 400 - Bad Request
export class BadRequestError extends HttpError {
  constructor(message: string = 'Bad Request', details?: Record<string, unknown>) {
    super(message, 400, 'ERR_BAD_REQUEST', details);
  }
}

// 401 - Unauthorized
export class UnauthorizedError extends HttpError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'ERR_UNAUTHORIZED');
  }
}

// 403 - Forbidden
export class ForbiddenError extends HttpError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'ERR_FORBIDDEN');
  }
}

// 404 - Not Found
export class NotFoundError extends HttpError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'ERR_NOT_FOUND');
  }
}

// 422 - Unprocessable Entity
export class ValidationError extends HttpError {
  constructor(message: string = 'Validation failed', details?: Record<string, unknown>) {
    super(message, 422, 'ERR_VALIDATION', details);
  }
}

// 500 - Internal Server Error
export class InternalServerError extends HttpError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500, 'ERR_INTERNAL');
  }
}

// 502 - Bad Gateway
export class BadGatewayError extends HttpError {
  constructor(message: string = 'Bad Gateway') {
    super(message, 502, 'ERR_BAD_GATEWAY');
  }
}

// 503 - Service Unavailable
export class ServiceUnavailableError extends HttpError {
  constructor(message: string = 'Service Unavailable') {
    super(message, 503, 'ERR_SERVICE_UNAVAILABLE');
  }
}

// 类型守卫：检查错误是否为 HttpError
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

// 提取 HTTP 状态码
export function getStatusCode(error: unknown): number {
  if (isHttpError(error)) {
    return error.statusCode;
  }
  if (error instanceof Error && 'statusCode' in error && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}
