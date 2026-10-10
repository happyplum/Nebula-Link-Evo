import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, selectStreamingState, selectActiveSessionId } from '../store/chat.store.js';
import { apiChatSessionMessages } from '@/shared/api/endpoints.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './Composer.module.css';

function toRequestUrl(path: string): string {
  if (/^https?:\/\//.test(path)) {
    return path;
  }

  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  return new URL(path, origin).toString();
}

interface ComposerProps {
  onDeleteSession?: () => void;
}

export const Composer: React.FC<ComposerProps> = ({ onDeleteSession }) => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const streamingState = useChatStore(selectStreamingState);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const addOptimisticTurn = useChatStore((s) => s.addOptimisticTurn);
  const reconcileOptimisticTurn = useChatStore((s) => s.reconcileOptimisticTurn);
  const setStreamingState = useChatStore((s) => s.setStreamingState);

  const isStreaming = streamingState === 'streaming';
  const isComposerDisabled = isStreaming || !activeSessionId;

  const handleSend = async () => {
    const content = input.trim();

    if (!content || isComposerDisabled || !activeSessionId) return;

    const optimisticTurnId = addOptimisticTurn(activeSessionId, content);
    setInput('');
    setStreamingState('streaming');

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const response = await fetch(toRequestUrl(apiChatSessionMessages(activeSessionId)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) throw new Error(`发送失败：HTTP ${response.status}`);
      const payload = (await response.json()) as { messageId?: unknown };
      if (typeof payload.messageId === 'string') {
        reconcileOptimisticTurn(activeSessionId, optimisticTurnId, payload.messageId);
      }
    } catch (error) {
      console.error('Failed to send chat message', error);
      setStreamingState('error');
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
        placeholder={isComposerDisabled ? 'Waiting...' : 'Type a message...'}
        disabled={isComposerDisabled}
        data-testid={testIds.composerInput}
        rows={1}
      />
      <div className={styles.actions}>
        {onDeleteSession && (
          <button
            type="button"
            className={`${styles.sessionAction} ${styles.deleteAction}`}
            onClick={onDeleteSession}
            title="删除会话"
          >
            删除会话
          </button>
        )}
        <div className={styles.actionsSpacer} />
        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={isComposerDisabled || !input.trim()}
          data-testid={testIds.sendButton}
          aria-label="Send message"
        >
          <svg className={styles.sendIcon} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <title>Send</title>
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
};
