import React from 'react';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ChatComposerShell.module.css';

export const ChatComposerShell: React.FC = () => {
  return (
    <div className={styles.container} data-testid={testIds.chatComposer}>
      <select
        className={styles.modelSelect}
        data-testid={testIds.chatComposerModelSelect}
        defaultValue="decision"
      >
        <option value="decision">决策模型</option>
        <option value="vision">视觉模型</option>
      </select>
      <div className={styles.textareaWrap}>
        <textarea
          className={styles.textarea}
          data-testid={testIds.chatComposerTextarea}
          rows={3}
          placeholder="输入消息... (Ctrl+Enter 发送)"
        />
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.actionBtn}
            data-testid={testIds.chatComposerScreenshotBtn}
            title="附加截图"
          >
            📷
          </button>
          <button
            type="button"
            className={styles.actionBtn}
            data-testid={testIds.chatComposerSendBtn}
            title="发送"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
};
