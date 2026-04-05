import React, { useState } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ThinkingBlock.module.css';

export interface ThinkingBlockProps {
  content: string;
  isStreaming?: boolean;
}

export const ThinkingBlock: React.FC<ThinkingBlockProps> = ({ content, isStreaming }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content) return null;

  return (
    <div
      className={`${styles.container} thinking-block ${isExpanded ? 'expanded' : ''}`}
      data-testid={testIds.thinkingBlock}
    >
      <button
        type="button"
        className={`${styles.header} thinking-header`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span>{isStreaming ? '💭 思考中...' : '💭 思考过程'}</span>
      </button>
      {isExpanded && <div className={`${styles.content} thinking-content`}>{content}</div>}
    </div>
  );
};
