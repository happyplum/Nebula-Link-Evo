import { describe, it, expect } from 'vitest';
import {
  HttpError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  InternalServerError,
  BadGatewayError,
  ServiceUnavailableError,
  isHttpError,
  getStatusCode,
} from '../errors/index.js';

describe('HttpError', () => {
  it('should create error with correct properties', () => {
    const error = new HttpError('Test', 400, 'ERR_TEST');
    expect(error.message).toBe('Test');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('ERR_TEST');
    expect(error.name).toBe('HttpError');
  });

  it('should create error with details', () => {
    const details = { field: 'email', value: 'invalid' };
    const error = new HttpError('Validation failed', 422, 'ERR_VALIDATION', details);
    expect(error.message).toBe('Validation failed');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('ERR_VALIDATION');
    expect(error.details).toEqual(details);
  });

  it('should convert to JSON correctly', () => {
    const error = new HttpError('Test', 400, 'ERR_TEST');
    const json = error.toJSON();
    expect(json).toEqual({
      success: false,
      error: 'Test',
      code: 'ERR_TEST',
      statusCode: 400,
    });
  });

  it('should convert to JSON with details', () => {
    const details = { field: 'email', value: 'invalid' };
    const error = new HttpError('Validation failed', 422, 'ERR_VALIDATION', details);
    const json = error.toJSON();
    expect(json).toEqual({
      success: false,
      error: 'Validation failed',
      code: 'ERR_VALIDATION',
      statusCode: 422,
      details,
    });
  });

  it('should propagate message to Error class', () => {
    const error = new HttpError('Test error', 400, 'ERR_TEST');
    expect(error.message).toBe('Test error');
  });
});

describe('BadRequestError', () => {
  it('should create error with default message', () => {
    const error = new BadRequestError();
    expect(error.message).toBe('Bad Request');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('ERR_BAD_REQUEST');
  });

  it('should create error with custom message', () => {
    const error = new BadRequestError('Invalid input');
    expect(error.message).toBe('Invalid input');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('ERR_BAD_REQUEST');
  });

  it('should create error with details', () => {
    const details = { field: 'password' };
    const error = new BadRequestError('Password too short', details);
    expect(error.message).toBe('Password too short');
    expect(error.details).toEqual(details);
  });
});

describe('UnauthorizedError', () => {
  it('should create error with default message', () => {
    const error = new UnauthorizedError();
    expect(error.message).toBe('Unauthorized');
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('ERR_UNAUTHORIZED');
  });

  it('should create error with custom message', () => {
    const error = new UnauthorizedError('Token expired');
    expect(error.message).toBe('Token expired');
    expect(error.statusCode).toBe(401);
    expect(error.code).toBe('ERR_UNAUTHORIZED');
  });
});

describe('ForbiddenError', () => {
  it('should create error with default message', () => {
    const error = new ForbiddenError();
    expect(error.message).toBe('Forbidden');
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('ERR_FORBIDDEN');
  });

  it('should create error with custom message', () => {
    const error = new ForbiddenError('Access denied');
    expect(error.message).toBe('Access denied');
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('ERR_FORBIDDEN');
  });
});

describe('NotFoundError', () => {
  it('should create error with default resource name', () => {
    const error = new NotFoundError();
    expect(error.message).toBe('Resource not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('ERR_NOT_FOUND');
  });

  it('should create error with custom resource name', () => {
    const error = new NotFoundError('User');
    expect(error.message).toBe('User not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('ERR_NOT_FOUND');
  });

  it('should create error with custom resource name', () => {
    const error = new NotFoundError('Order');
    expect(error.message).toBe('Order not found');
    expect(error.statusCode).toBe(404);
    expect(error.code).toBe('ERR_NOT_FOUND');
  });
});

describe('ValidationError', () => {
  it('should create error with default message', () => {
    const error = new ValidationError();
    expect(error.message).toBe('Validation failed');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('ERR_VALIDATION');
  });

  it('should create error with custom message', () => {
    const error = new ValidationError('Invalid email format');
    expect(error.message).toBe('Invalid email format');
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('ERR_VALIDATION');
  });

  it('should create error with details', () => {
    const details = { email: ['Invalid email format'] };
    const error = new ValidationError('Validation failed', details);
    expect(error.message).toBe('Validation failed');
    expect(error.details).toEqual(details);
  });
});

describe('InternalServerError', () => {
  it('should create error with default message', () => {
    const error = new InternalServerError();
    expect(error.message).toBe('Internal Server Error');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('ERR_INTERNAL');
  });

  it('should create error with custom message', () => {
    const error = new InternalServerError('Database connection failed');
    expect(error.message).toBe('Database connection failed');
    expect(error.statusCode).toBe(500);
    expect(error.code).toBe('ERR_INTERNAL');
  });
});

describe('BadGatewayError', () => {
  it('should create error with default message', () => {
    const error = new BadGatewayError();
    expect(error.message).toBe('Bad Gateway');
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('ERR_BAD_GATEWAY');
  });

  it('should create error with custom message', () => {
    const error = new BadGatewayError('Upstream service unavailable');
    expect(error.message).toBe('Upstream service unavailable');
    expect(error.statusCode).toBe(502);
    expect(error.code).toBe('ERR_BAD_GATEWAY');
  });
});

describe('ServiceUnavailableError', () => {
  it('should create error with default message', () => {
    const error = new ServiceUnavailableError();
    expect(error.message).toBe('Service Unavailable');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('ERR_SERVICE_UNAVAILABLE');
  });

  it('should create error with custom message', () => {
    const error = new ServiceUnavailableError('Maintenance in progress');
    expect(error.message).toBe('Maintenance in progress');
    expect(error.statusCode).toBe(503);
    expect(error.code).toBe('ERR_SERVICE_UNAVAILABLE');
  });
});

describe('isHttpError', () => {
  it('should return true for HttpError instances', () => {
    const error = new BadRequestError();
    expect(isHttpError(error)).toBe(true);
  });

  it('should return false for regular Error instances', () => {
    const error = new Error('Regular error');
    expect(isHttpError(error)).toBe(false);
  });

  it('should return false for plain objects', () => {
    const obj = { message: 'Error' };
    expect(isHttpError(obj)).toBe(false);
  });

  it('should return false for null and undefined', () => {
    expect(isHttpError(null)).toBe(false);
    expect(isHttpError(undefined)).toBe(false);
  });

  it('should return false for strings', () => {
    expect(isHttpError('error')).toBe(false);
  });
});

describe('getStatusCode', () => {
  it('should return statusCode from HttpError instances', () => {
    const error = new BadRequestError();
    expect(getStatusCode(error)).toBe(400);
  });

  it('should return 500 for regular Error instances with statusCode property', () => {
    const error = new Error('Error');
    (error as Error & { statusCode: number }).statusCode = 500;
    expect(getStatusCode(error)).toBe(500);
  });

  it('should return 500 for Error instances without statusCode', () => {
    const error = new Error('Error');
    expect(getStatusCode(error)).toBe(500);
  });

  it('should return 500 for non-Error values', () => {
    expect(getStatusCode(null)).toBe(500);
    expect(getStatusCode('error')).toBe(500);
    expect(getStatusCode({})).toBe(500);
  });
});
