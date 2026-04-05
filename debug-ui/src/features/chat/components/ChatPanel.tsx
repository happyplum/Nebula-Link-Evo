import React from 'react';
import { ErrorBoundary } from '@/shared/ui/index.js';
import { SessionSelector } from './SessionSelector.js';
import { MessageList } from './MessageList.js';
import { Composer } from './Composer.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatPanel.module.css';

export const ChatPanel: React.FC = () => {
  return (
    <ErrorBoundary>
      <div className={styles.container} data-testid={testIds.chatPanel}>
        <SessionSelector />
        <MessageList />
        <Composer />
      </div>
    </ErrorBoundary>
  );
};
