import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import {
  useChatStore,
  selectActiveMessages,
  selectActiveSessionId,
  selectStreamingState,
  selectStreamingContent,
  selectStreamingThinking,
} from '../store/chat.store.js';
import { MessageBubble } from './MessageBubble.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageList.module.css';

const DEFAULT_PAGE_SIZE = 50;

export const MessageList: React.FC = () => {
  const messages = useChatStore(selectActiveMessages);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const streamingState = useChatStore(selectStreamingState);
  const streamingContent = useChatStore(selectStreamingContent);
  const streamingThinking = useChatStore(selectStreamingThinking);

  const isStreaming = streamingState === 'streaming';

  const streamingMessage = useMemo(() => {
    if (!isStreaming || (!streamingContent && !streamingThinking)) return null;
    return {
      id: '__streaming__',
      role: 'assistant' as const,
      content: streamingContent || '',
      thinking: streamingThinking || undefined,
      isStreaming: true,
      timestamp: Date.now(),
    };
  }, [isStreaming, streamingContent, streamingThinking]);
  const visibleCount = useChatStore((s) =>
    activeSessionId ? (s.visibleMessageCounts[activeSessionId] ?? DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
  );
  const expandVisibleMessages = useChatStore((s) => s.expandVisibleMessages);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);
  const prevLengthRef = useRef(0);

  // Determine visible messages (most recent N)
  const hasMore = messages.length > visibleCount;
  const visibleMessages = hasMore
    ? messages.slice(messages.length - visibleCount)
    : messages;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    if (!isUserScrolling.current || messages.length > prevLengthRef.current) {
      container.scrollTop = container.scrollHeight;
    }
    prevLengthRef.current = messages.length;
  }, [messages]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    const isAtBottom = 
      Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 50;
    
    isUserScrolling.current = !isAtBottom;
  };

  const handleLoadMore = useCallback(() => {
    if (activeSessionId) {
      expandVisibleMessages(activeSessionId);
    }
  }, [activeSessionId, expandVisibleMessages]);

  if (messages.length === 0 && !streamingMessage) {
    return (
      <div className={styles.container} data-testid={testIds.messageList}>
        <div className={styles.emptyState}>
          No messages yet. Start a conversation!
        </div>
      </div>
    );
  }

  return (
    <div 
      className={styles.container} 
      ref={containerRef}
      onScroll={handleScroll}
      data-testid={testIds.messageList}
    >
      {hasMore && (
        <div className={styles.loadMore}>
          <button 
            type="button" 
            className={styles.loadMoreButton} 
            onClick={handleLoadMore}
          >
            Load earlier messages
          </button>
        </div>
      )}
      {visibleMessages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {streamingMessage && (
        <MessageBubble key={streamingMessage.id} message={streamingMessage} />
      )}
    </div>
  );
};
