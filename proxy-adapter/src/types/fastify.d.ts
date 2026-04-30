import 'fastify';
import { TaskService } from '../services/task-service.js';
import { BrowserClient } from '../browser-client.js';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';

declare module 'fastify' {
  interface FastifyInstance {
    taskExecutor: TaskService;
    browserClient: BrowserClient;
    conversationManager: ConversationManager;
    chatHandler: ChatHandler;
  }
}
