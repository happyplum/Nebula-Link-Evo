import fp from 'fastify-plugin';
import cors from '@fastify/cors';

/**
 * Resolve CORS origin from CORS_ORIGINS env var.
 * - Comma-separated whitelist, "*" for all, default ["http://localhost:5173"]
 */
function resolveCorsOrigin(): (string | RegExp)[] | boolean {
  const envVal = process.env.CORS_ORIGINS;
  if (!envVal) {
    return ['http://localhost:5173'];
  }
  if (envVal === '*') {
    return true;
  }
  return envVal.split(',').map(o => o.trim()).filter(Boolean);
}

/**
 * CORS 插件
 * 必须最先注册，确保所有路由都有跨域支持
 */
export default fp(
  async (fastify) => {
    await fastify.register(cors, {
      origin: resolveCorsOrigin(),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    fastify.log.info('CORS plugin registered');
  },
  {
    name: 'cors',
    fastify: '5.x',
  }
);
