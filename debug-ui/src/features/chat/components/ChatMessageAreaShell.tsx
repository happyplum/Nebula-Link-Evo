import React from 'react';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatMessageAreaShell.module.css';

export const ChatMessageAreaShell: React.FC = () => {
  return (
    <div className={styles.container} data-testid={testIds.chatMessageArea}>
      <div className={styles.emptyState} data-testid={testIds.chatMessageAreaEmpty}>
        选择或创建会话以开始
      </div>
    </div>
  );
};
