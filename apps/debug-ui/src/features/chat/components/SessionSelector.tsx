import React from 'react';
import { useChatStore, selectSessions, selectActiveSessionId } from '../store/chat.store.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './SessionSelector.module.css';

export const SessionSelector: React.FC = () => {
  const sessions = useChatStore(selectSessions);
  const activeSessionId = useChatStore(selectActiveSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setActiveSession(value === '' ? null : value);
  };

  return (
    <div className={styles.container}>
      <select
        className={styles.select}
        value={activeSessionId || ''}
        onChange={handleChange}
        data-testid={testIds.sessionSelector}
      >
        <option value="" disabled>
          选择会话...
        </option>
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {session.title || `Session ${session.id.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </div>
  );
};
