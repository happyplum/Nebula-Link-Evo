import { DatabaseManager } from './db.js';
import type { Message } from './types.js';

interface CompressorConfig {
  compressThreshold?: number;
  keepRecentCount?: number;
}

interface AIClient {
  generateSummary(messages: Message[]): Promise<string>;
}

interface CompressedContext {
  summary: string | null;
  messages: Message[];
}

class SessionCompressor {
  private db: DatabaseManager;
  private compressThreshold: number;
  private keepRecentCount: number;

  constructor(db: DatabaseManager, config: CompressorConfig = {}) {
    this.db = db;
    this.compressThreshold = config.compressThreshold ?? 20;
    this.keepRecentCount = config.keepRecentCount ?? 5;
  }

  shouldCompress(sessionId: string): boolean {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return false;
    }
    return session.message_count > this.compressThreshold;
  }

  async compress(sessionId: string, aiClient: AIClient): Promise<void> {
    const session = this.db.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const allMessages = this.db.getMessagesBySession(sessionId);
    const nonSummaryMessages = allMessages.filter((m) => m.metadata?.type !== 'summary');

    if (nonSummaryMessages.length <= this.keepRecentCount) {
      return;
    }

    const importantMessages = nonSummaryMessages.filter((m) => m.metadata?.important === true);

    const messagesToSummarize = nonSummaryMessages
      .slice(0, -this.keepRecentCount)
      .filter((m) => !importantMessages.includes(m));

    if (messagesToSummarize.length === 0) {
      return;
    }

    const summary = await aiClient.generateSummary(messagesToSummarize);

    messagesToSummarize.forEach((m) => {
      this.db.deleteMessage(m.id);
    });

    this.db.createMessage({
      session_id: sessionId,
      role: 'system',
      content: summary,
      metadata: { type: 'summary' },
    });

    try {
      this.db.updateSession(sessionId, { summary });
    } catch (err) {
      console.error('Failed to update session summary:', err);
    }
  }

  getCompressedContext(sessionId: string): CompressedContext {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return { summary: null, messages: [] };
    }

    const allMessages = this.db.getMessagesBySession(sessionId);
    const summaryMessage = allMessages.find((m) => m.metadata?.type === 'summary');
    const nonSummaryMessages = allMessages.filter((m) => m.metadata?.type !== 'summary');

    if (!summaryMessage) {
      return {
        summary: null,
        messages: nonSummaryMessages,
      };
    }

    return {
      summary: summaryMessage.content,
      messages: nonSummaryMessages,
    };
  }
}

export { SessionCompressor };
export type { CompressorConfig, AIClient, CompressedContext };
