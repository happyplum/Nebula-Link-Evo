import React, { useEffect, useRef, useCallback, useMemo } from 'react';
import {
  useChatStore,
  selectActiveMessages,
  selectActiveSessionId,
  selectStreamingState,
  selectStreamingContent,
  selectStreamingThinking,
  selectStreamingToolCalls,
} from '../store/chat.store.js';
import { MessageBubble } from './MessageBubble.js';
import { ToolCallCard } from './ToolCallCard.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageList.module.css';

const DEFAULT_PAGE_SIZE = 50;

export const MessageList: React.FC = () => {
  const messages = useChatStore(selectActiveMessages);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const streamingState = useChatStore(selectStreamingState);
  const streamingContent = useChatStore(selectStreamingContent);
  const streamingThinking = useChatStore(selectStreamingThinking);
  const streamingToolCalls = useChatStore(selectStreamingToolCalls);

  const isStreaming = streamingState === 'streaming';

  const streamingMessage = useMemo(() => {
    if (!isStreaming || (!streamingContent && !streamingThinking && streamingToolCalls.length === 0)) return null;
    return {
      id: '__streaming__',
      role: 'assistant' as const,
      content: streamingContent || '',
      thinking: streamingThinking || undefined,
      isStreaming: true,
      timestamp: Date.now(),
    };
  }, [isStreaming, streamingContent, streamingThinking, streamingToolCalls]);
  const visibleCount = useChatStore((s) =>
    activeSessionId ? (s.visibleMessageCounts[activeSessionId] ?? DEFAULT_PAGE_SIZE) : DEFAULT_PAGE_SIZE,
  );
  const expandVisibleMessages = useChatStore((s) => s.expandVisibleMessages);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);
  const prevLengthRef = useRef(0);
  const prevToolCallsRef = useRef(0);
  const prevStreamingLengthRef = useRef(0);

  // Determine visible messages (most recent N)
  const hasMore = messages.length > visibleCount;
  const visibleMessages = hasMore
    ? messages.slice(messages.length - visibleCount)
    : messages;

  // Auto-scroll to bottom when new messages arrive, streaming tool calls update, or streaming content changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || (messages.length === 0 && streamingToolCalls.length === 0)) return;

    const currentStreamingLength = (streamingContent?.length || 0) + (streamingThinking?.length || 0);
    const shouldScroll =
      !isUserScrolling.current ||
      messages.length > prevLengthRef.current ||
      streamingToolCalls.length > prevToolCallsRef.current ||
      currentStreamingLength > prevStreamingLengthRef.current;

    if (shouldScroll) {
      container.scrollTop = container.scrollHeight;
    }
    prevLengthRef.current = messages.length;
    prevToolCallsRef.current = streamingToolCalls.length;
    prevStreamingLengthRef.current = currentStreamingLength;
  }, [messages, streamingToolCalls, streamingContent, streamingThinking]);

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
      {visibleMessages.flatMap((message) => {
        const items: React.ReactNode[] = [];
        if (message.toolCalls?.length) {
          message.toolCalls.forEach((tc) => {
            items.push(<ToolCallCard key={`tc-${message.id}-${tc.id}`} toolCall={tc} />);
          });
        }
        // Only render assistant bubble if there's actual content (text, thinking, or screenshot)
        if (message.role === 'assistant' && !message.content && !message.thinking && !message.screenshot) {
          // Tool-only message - skip the bubble, tool calls render above
        } else {
          items.push(<MessageBubble key={message.id} message={message} />);
        }
        return items;
      })}
      {isStreaming && streamingToolCalls.length > 0 &&
        streamingToolCalls.map((tc) => (
          <ToolCallCard key={`stc-${tc.id}`} toolCall={tc} />
        ))}
      {streamingMessage && (
        <MessageBubble key={streamingMessage.id} message={streamingMessage} />
      )}
    </div>
  );
};
