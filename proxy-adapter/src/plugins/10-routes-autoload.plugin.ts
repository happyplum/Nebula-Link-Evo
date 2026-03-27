import fp from 'fastify-plugin';
import autoLoad from '@fastify/autoload';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 业务路由自动加载插件
 * 自动加载 routes/ 目录下的所有路由模块
 */
export default fp(
  async (fastify) => {
    await fastify.register(autoLoad, {
      dir: join(__dirname, 'routes'),
      options: {
        prefix: '',
      },
      ignorePattern: /.*\.test\.(ts|js)$/,
      logLevel: 'debug',
    });
    fastify.log.info('✅ Routes autoloaded from plugins/routes/');
  },
  {
    name: 'routes-autoload',
    fastify: '5.x',
    dependencies: ['swagger', 'error-handler'],
  }
);
