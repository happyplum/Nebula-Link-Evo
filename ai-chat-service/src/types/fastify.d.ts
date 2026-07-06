import 'fastify';
import type { ConversationManager } from '../conversation/manager.js';
import type { ChatHandler } from '../conversation/chat-handler.js';
import type { ConversationJobQueue } from '../services/conversation-job-queue.js';

declare module 'fastify' {
  interface FastifySchema {
    description?: string;
    tags?: string[];
  }

  interface FastifyInstance {
    conversationManager: ConversationManager;
    chatHandler: ChatHandler;
    jobQueue: ConversationJobQueue;
  }
}
