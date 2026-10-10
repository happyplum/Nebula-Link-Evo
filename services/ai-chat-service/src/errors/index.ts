/**
 * 错误模块入口
 * 导出所有错误类和工具函数
 */

export {
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
} from './http-errors.js';

export { HttpError as default } from './http-errors.js';
