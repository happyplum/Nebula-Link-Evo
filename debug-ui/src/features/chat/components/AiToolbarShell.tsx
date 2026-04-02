import React from 'react';
import { testIds } from '@/shared/testing/testids.js';
import styles from './AiToolbarShell.module.css';

export const AiToolbarShell: React.FC = () => {
  return (
    <div className={styles.container} data-testid={testIds.aiToolbar}>
      <div className={styles.sessionRow}>
        <select
          className={styles.sessionSelect}
          data-testid={testIds.aiToolbarSessionSelect}
          defaultValue=""
        >
          <option value="" disabled>选择会话...</option>
        </select>
        <button
          type="button"
          className={styles.btn}
          data-testid={testIds.aiToolbarNewSessionBtn}
          title="新建会话"
        >
          ＋
        </button>
      </div>
      <div className={styles.stateControls}>
        <button
          type="button"
          className={styles.btn}
          data-testid={testIds.aiToolbarClearSessionBtn}
          title="清除会话"
        >
          🗑️ 清除
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnStop}`}
          data-testid={testIds.aiToolbarStopBtn}
          title="停止生成"
        >
          ⏹ 停止
        </button>
      </div>
    </div>
  );
};
