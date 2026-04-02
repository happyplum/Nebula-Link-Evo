import React, { useState } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ThinkingBlock.module.css';

export interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(isStreaming || false);

  if (!content) return null;

  return (
    <div className={styles.container} data-testid={testIds.thinkingBlock}>
      <button 
        type="button"
        className={styles.header} 
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <svg 
          className={`${styles.icon} ${isExpanded ? styles.iconExpanded : ''}`} 
          viewBox="0 0 24 24" 
          xmlns="http://www.w3.org/2000/svg"
        >
          <title>{isExpanded ? 'Collapse' : 'Expand'}</title>
          <path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z" />
        </svg>
        <span>{isStreaming ? 'Thinking...' : 'Thought Process'}</span>
      </button>
      {isExpanded && (
        <div className={styles.content}>
          {content}
        </div>
      )}
    </div>
  );
};
