import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, selectStreamingState, selectActiveSessionId } from '../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './Composer.module.css';

export const Composer: React.FC = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const streamingState = useChatStore(selectStreamingState);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const addOptimisticMessage = useChatStore((s) => s.addOptimisticMessage);

  const isStreaming = streamingState === 'streaming';
  const isDisabled = isStreaming || !activeSessionId;

  const handleSend = () => {
    if (!input.trim() || isDisabled || !activeSessionId) return;
    
    addOptimisticMessage(activeSessionId, input.trim());
    setInput('');
    
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    
    // Auto-resize
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  };

  // Focus input when session changes
  useEffect(() => {
    if (activeSessionId && !isStreaming && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [activeSessionId, isStreaming]);

  return (
    <div className={styles.container}>
      <textarea
        ref={textareaRef}
        className={styles.input}
        value={input}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        placeholder={isDisabled ? 'Waiting...' : 'Type a message...'}
        disabled={isDisabled}
        data-testid={testIds.composerInput}
        rows={1}
      />
      <button
        type="button"
        className={styles.sendButton}
        onClick={handleSend}
        disabled={isDisabled || !input.trim()}
        data-testid={testIds.sendButton}
        aria-label="Send message"
      >
        <svg className={styles.sendIcon} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <title>Send</title>
          <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
        </svg>
      </button>
    </div>
  );
};
