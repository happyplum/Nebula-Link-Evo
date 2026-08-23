import 'fastify';
import type { ConversationManager } from '../conversation/manager.js';
import type { ChatHandler } from '../conversation/chat-handler.js';
import type { ConversationJobQueue } from '../services/conversation-job-queue.js';
import type { HarnessDeletionService } from '../harness/deletion-service.js';
import type { ConversationDatabase } from '../db/ConversationDatabase.js';
import type { AppService } from '../services/app-service.js';
import type { ChatSessionController } from '../services/chat-session-controller.js';
import type { SessionEventHub } from '../conversation/session-event-hub.js';
import type { ConnectivityGateService } from '../services/connectivity-gate-service.js';
import type { HarnessRuntime } from '../harness/types.js';
import type { HarnessRunScheduler } from '../harness/run-scheduler.js';

declare module 'fastify' {
  interface FastifySchema {
    description?: string;
    tags?: string[];
  }

  interface FastifyInstance {
    conversationManager: ConversationManager;
    chatHandler: ChatHandler;
    jobQueue: ConversationJobQueue;
    deletionService: HarnessDeletionService;
    conversationDatabase: ConversationDatabase;
    appService: AppService;
    chatSessionController: ChatSessionController;
    sessionEventHub: SessionEventHub;
    connectivityGate: ConnectivityGateService;
    harnessRuntime: HarnessRuntime;
    harnessRunScheduler: HarnessRunScheduler;
  }
}
