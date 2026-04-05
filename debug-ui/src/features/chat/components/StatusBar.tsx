import React from 'react';
import { useChatStore, selectStreamingState } from '../store/chat.store.js';
import { StatusIndicator } from '@/shared/ui/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './StatusBar.module.css';

export const StatusBar: React.FC = () => {
  const streamingState = useChatStore(selectStreamingState);

  let status: 'online' | 'offline' | 'loading' | 'error' = 'offline';
  let label = '空闲';

  switch (streamingState) {
    case 'streaming':
      status = 'loading';
      label = '生成中...';
      break;
    case 'paused':
      status = 'offline';
      label = '已暂停';
      break;
    case 'error':
      status = 'error';
      label = '异常';
      break;
    case 'idle':
    default:
      status = 'online';
      label = '就绪';
      break;
  }

  return (
    <div className={styles.container} data-testid={testIds.statusBar}>
      <StatusIndicator status={status} label={label} size="sm" />
    </div>
  );
};
