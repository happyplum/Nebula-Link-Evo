import 'fastify';
import { AppService } from '../services/app-service.js';
import { BrowserClient } from '../browser-client.js';
import { ConversationManager } from '../conversation/manager.js';
import { ChatHandler } from '../conversation/chat-handler.js';
import { ConversationJobQueue } from '../services/conversation-job-queue.js';

declare module 'fastify' {
  interface FastifyInstance {
    taskExecutor: AppService;
    browserClient: BrowserClient;
    conversationManager: ConversationManager;
    chatHandler: ChatHandler;
    jobQueue: ConversationJobQueue;
  }
}
