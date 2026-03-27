import fp from 'fastify-plugin';
import cors from '@fastify/cors';

/**
 * CORS 插件
 * 必须最先注册，确保所有路由都有跨域支持
 */
export default fp(
  async (fastify) => {
    await fastify.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    fastify.log.info('✅ CORS plugin registered');
  },
  {
    name: 'cors',
    fastify: '5.x',
  }
);
