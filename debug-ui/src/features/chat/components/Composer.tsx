import React, { useState, useRef, useEffect } from 'react';
import { useChatStore, selectStreamingState, selectActiveSessionId, selectScreenshotData } from '../store/chat.store.js';
import { useRuntimeStore, selectConnectionStatus } from '@/features/runtime/store/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './Composer.module.css';

export const Composer: React.FC = () => {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  const streamingState = useChatStore(selectStreamingState);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const screenshotData = useChatStore(selectScreenshotData);
  const addOptimisticMessage = useChatStore((s) => s.addOptimisticMessage);
  const setScreenshotData = useChatStore((s) => s.setScreenshotData);
  const clearScreenshotData = useChatStore((s) => s.clearScreenshotData);

  const connectionStatus = useRuntimeStore(selectConnectionStatus);

  const isStreaming = streamingState === 'streaming';
  const isDisabled = isStreaming || !activeSessionId || connectionStatus !== 'connected';

  const handleSend = () => {
    if ((!input.trim() && !screenshotData) || isDisabled || !activeSessionId) return;
    
    addOptimisticMessage(activeSessionId, input.trim());
    setInput('');
    clearScreenshotData();
    
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

  const handleScreenshot = async () => {
    try {
      setScreenshotData('loading'); // Just to show active state if needed, or we can leave it
      const res = await fetch('/debug/api/playwright/screenshot');
      if (!res.ok) throw new Error('Failed to fetch screenshot');
      const data = await res.json();
      if (data.screenshot) {
        setScreenshotData(`data:image/png;base64,${data.screenshot}`);
      } else {
        clearScreenshotData();
      }
    } catch (e) {
      console.error('Screenshot failed', e);
      clearScreenshotData();
    }
  };

  return (
    <div className={styles.container}>
      {screenshotData && (
        <div className={styles.screenshotPreview}>
          <img src={screenshotData} alt="Screenshot preview" />
          <button type="button" className={styles.removeScreenshot} onClick={clearScreenshotData}>✕</button>
        </div>
      )}
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
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.screenshotButton} ${screenshotData ? styles.screenshotActive : ''}`}
          onClick={handleScreenshot}
          disabled={isDisabled}
          title="附加截图"
        >
          📷
        </button>
        <button
          type="button"
          className={styles.sendButton}
          onClick={handleSend}
          disabled={isDisabled || (!input.trim() && !screenshotData)}
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
