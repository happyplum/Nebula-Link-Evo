import fp from 'fastify-plugin';
import { FastifyError } from 'fastify';
import { isHttpError } from '../errors/index.js';

/**
 * 全局错误处理插件
 * 统一所有错误响应格式
 */
export default fp(
  async (fastify) => {
    fastify.setErrorHandler((error: FastifyError, request, reply) => {
      // 记录错误日志
      request.log.error(
        {
          err: error,
          request: {
            method: request.method,
            url: request.url,
          },
        },
        'Request error'
      );

      // 如果是 HttpError，使用其属性
      if (isHttpError(error)) {
        reply.status(error.statusCode).send(error.toJSON());
        return;
      }

      // 否则使用标准 Fastify 错误处理
      const statusCode = error.statusCode || 500;
      const errorResponse = {
        success: false,
        error: error.message || 'Internal Server Error',
        code: `ERR_${statusCode}`,
        ...(process.env.NODE_ENV !== 'production' && {
          stack: error.stack,
        }),
      };

      reply.status(statusCode).send(errorResponse);
    });
    fastify.setNotFoundHandler((request, reply) => {
      reply.status(404).send({
        success: false,
        error: `Route ${request.method}:${request.url} not found`,
        code: 'ERR_404',
      });
    });
    fastify.log.info('✅ Global error handler registered');
  },
  {
    name: 'error-handler',
    fastify: '5.x',
    dependencies: ['swagger'],
  }
);
