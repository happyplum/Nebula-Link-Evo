import React, { useEffect, useRef } from 'react';
import { useChatStore, selectActiveMessages } from '../store/chat.store.js';
import { MessageBubble } from './MessageBubble.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageList.module.css';

export const MessageList: React.FC = () => {
  const messages = useChatStore(selectActiveMessages);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolling = useRef(false);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const container = containerRef.current;
    if (!container || messages.length === 0) return;

    // Only auto-scroll if the user hasn't scrolled up significantly
    if (!isUserScrolling.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    // Check if user has scrolled up from the bottom
    const isAtBottom = 
      Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 50;
    
    isUserScrolling.current = !isAtBottom;
  };

  if (messages.length === 0) {
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
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
};
