import React from 'react';
import type { ChatMessage } from '../types/index.js';
import { useChatStore, selectShowThinking } from '../store/chat.store.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageBubble.module.css';

function formatTimestamp(message: ChatMessage): string | null {
  const raw = message.created_at ?? message.timestamp;
  if (raw == null) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = React.memo(
  ({ message }) => {
    const isUser = message.role === 'user';
    const showThinking = useChatStore(selectShowThinking);
    const metaLabel = formatTimestamp(message) ?? (isUser ? 'You' : 'Nebula');
    const avatarLabel = isUser ? '🧑' : '🤖';

    return (
      <div
        className={`${styles.container} ${isUser ? styles.user : styles.assistant}`}
        data-testid={testIds.messageBubble}
        data-role={message.role}
      >
        <div className={styles.avatar} aria-hidden="true">
          {avatarLabel}
        </div>
        <div className={styles.bubbleContainer}>
          {showThinking && message.thinking && (
            <ThinkingBlock content={message.thinking} isStreaming={message.isStreaming} />
          )}
          <div className={styles.bubble}>
            {(message.content || message.isStreaming) && (
              <div className={isUser ? styles.content : styles.markdownContent}>
                {isUser ? (
                  message.content
                ) : (
                  <MarkdownRenderer content={message.content || ''} />
                )}
                {message.isStreaming && <span className={styles.streamingCursor} aria-hidden="true">▌</span>}
              </div>
            )}

            {message.screenshot && (
              <img src={message.screenshot} alt="Screenshot" className={styles.screenshot} />
            )}


          </div>
          <div className={styles.meta}>{metaLabel}</div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.thinking === nextProps.message.thinking &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.screenshot === nextProps.message.screenshot
    );
  }
);
