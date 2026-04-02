import React from 'react';
import type { ChatMessage } from '../types/index.js';
import { ThinkingBlock } from './ThinkingBlock.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './MessageBubble.module.css';

export interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div 
      className={`${styles.container} ${isUser ? styles.user : styles.assistant}`}
      data-testid={testIds.messageBubble}
      data-role={message.role}
    >
      <div className={styles.bubble}>
        {message.thinking && (
          <ThinkingBlock 
            content={message.thinking} 
            isStreaming={message.isStreaming} 
          />
        )}
        
        {message.content && (
          <div className={styles.content}>{message.content}</div>
        )}

        {message.screenshot && (
          <img 
            src={message.screenshot} 
            alt="Screenshot" 
            className={styles.screenshot} 
          />
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={styles.toolCalls}>
            {message.toolCalls.map((tool) => (
              <div key={tool.id} className={styles.toolCall}>
                <span className={styles.toolCallName}>{tool.name}</span>
                {tool.status && (
                  <span className={styles.toolCallStatus}>[{tool.status}]</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
