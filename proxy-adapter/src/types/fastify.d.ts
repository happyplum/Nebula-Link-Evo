import 'fastify';
import { AppService } from '../services/app-service.js';
import { BrowserClient } from '../browser-client.js';

declare module 'fastify' {
  interface FastifyInstance {
    taskExecutor: AppService;
    browserClient: BrowserClient;
  }
}
