import React from 'react';
import { useChatStore, selectStreamingState } from '../store/chat.store.js';
import { StatusIndicator } from '@/shared/ui/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './StatusBar.module.css';

export const StatusBar: React.FC = () => {
  const streamingState = useChatStore(selectStreamingState);

  let status: 'online' | 'offline' | 'loading' | 'error' = 'offline';
  let label = 'Idle';

  switch (streamingState) {
    case 'streaming':
      status = 'loading';
      label = 'Assistant is typing...';
      break;
    case 'paused':
      status = 'offline';
      label = 'Paused';
      break;
    case 'error':
      status = 'error';
      label = 'Error';
      break;
    case 'idle':
    default:
      status = 'online';
      label = 'Ready';
      break;
  }

  return (
    <div className={styles.container} data-testid={testIds.statusBar}>
      <StatusIndicator status={status} label={label} size="sm" />
    </div>
  );
};
