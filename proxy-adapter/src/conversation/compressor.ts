import { DatabaseManager } from './db.js';
import type { Message } from './types.js';
import { createWorkerLogger } from '../services/logger.js';

interface CompressorConfig {
  /** Minimum message count to trigger compression (default 20) */
  compressThreshold?: number;
}

interface AIClient {
  generateSummary(messages: Message[]): Promise<string>;
}

interface CompressedContext {
  summary: string | null;
  messages: Message[];
}

/**
 * Create a lightweight placeholder for a tool call result.
 * Preserves the tool name so the summarizer knows what was called,
 * but discards the bulky payload (DOM snapshots, page state, etc.).
 */
function stripToolContent(message: Message): Message {
  if (message.role !== 'tool') {
    return message;
  }
  const toolName =
    message.metadata && typeof message.metadata.tool_name === 'string'
      ? message.metadata.tool_name
      : 'unknown';

  // Keep first 200 chars as a hint, discard the rest
  const hint = message.content.length > 200
    ? message.content.slice(0, 200) + '…'
    : message.content;

  return {
    ...message,
    content: `[工具调用结果 ${toolName}]: ${hint}`,
  };
}

/**
 * Prepare messages for summarization:
 * 1. Strip all tool call results to lightweight placeholders
 * 2. Keep user and assistant messages as-is (they contain the semantic flow)
 *
 * This gives the AI full conversational context without the bulk.
 */
function prepareMessagesForSummary(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return stripToolContent(msg);
    }
    return msg;
  });
}

class SessionCompressor {
  private db: DatabaseManager;
  private compressThreshold: number;
  private logger = createWorkerLogger('compressor');

  constructor(db: DatabaseManager, config: CompressorConfig = {}) {
    this.db = db;
    this.compressThreshold = config.compressThreshold ?? 20;
  }

  shouldCompress(sessionId: string): boolean {
    const session = this.db.getSession(sessionId);
    if (!session) {
      return false;
    }
    return session.message_count > this.compressThreshold;
  }

  /**
   * Compress session history:
   * 1. Take ALL non-summary messages
   * 2. Strip tool call results to lightweight placeholders
   * 3. Pass full stripped context to AI for summarization
   * 4. Delete old messages, insert summary
   * 5. Keep the most recent user message for conversation continuity
   */
  async compress(sessionId: string, aiClient: AIClient): Promise<void> {
    const session = this.db.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const allMessages = this.db.getMessagesBySession(sessionId);
    const nonSummaryMessages = allMessages.filter((m) => m.metadata?.type !== 'summary');

    // Need at least 2 messages to be worth compressing
    if (nonSummaryMessages.length <= 1) {
      return;
    }

    // Find the most recent user message — we'll keep it for continuity
    let lastUserMsgId: string | null = null;
    for (let i = nonSummaryMessages.length - 1; i >= 0; i--) {
      if (nonSummaryMessages[i].role === 'user') {
        lastUserMsgId = nonSummaryMessages[i].id;
        break;
      }
    }

    // Messages to summarize: everything except the kept ones
    const messagesToDelete = nonSummaryMessages.filter((m) => m.id !== lastUserMsgId);

    if (messagesToDelete.length === 0) {
      return;
    }

    // Prepare full context for summarization with tool results stripped
    const strippedMessages = prepareMessagesForSummary(nonSummaryMessages);

    this.logger.info(
      {
        sessionId,
        totalMessages: nonSummaryMessages.length,
        messagesToSummarize: messagesToDelete.length,
        keptMessageId: lastUserMsgId,
      },
      'Starting compression — tool results stripped, full context for AI summary',
    );

    // Call AI with the stripped full context
    const summary = await aiClient.generateSummary(strippedMessages);

    // Delete old messages
    for (const m of messagesToDelete) {
      this.db.deleteMessage(m.id);
    }

    // Insert summary as a system message at the beginning
    this.db.createMessage({
      session_id: sessionId,
      role: 'system',
      content: summary,
      metadata: { type: 'summary' },
    });

    try {
      this.db.updateSession(sessionId, { summary });
    } catch (err) {
      this.logger.error({ err, sessionId }, 'Failed to update session summary');
    }

    this.logger.info(
      { sessionId, summaryLength: summary.length },
      'Compression complete',
    );
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
