import React, { useRef, useCallback } from 'react';
import type { ToolCall } from '../types/index.js';
import styles from './ToolCallCard.module.css';

export interface ToolCallCardProps {
  toolCall: ToolCall;
}

function extractDisplayName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(dot + 1);
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export const ToolCallCard: React.FC<ToolCallCardProps> = React.memo(
  ({ toolCall }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const displayName = extractDisplayName(toolCall.name);

    const openDialog = useCallback(() => {
      dialogRef.current?.showModal();
    }, []);

    const closeDialog = useCallback(() => {
      dialogRef.current?.close();
    }, []);

    const handleBackdropClick = useCallback(
      (e: React.MouseEvent<HTMLDialogElement>) => {
        if (e.target === dialogRef.current) closeDialog();
      },
      [closeDialog],
    );

    return (
      <>
        <button type="button" className={styles.card} onClick={openDialog}>
          <span className={styles.chevron}>▸</span>
          <code
            className={`${styles.toolName} ${toolCall.status === 'running' ? styles.statusRunning : toolCall.status === 'error' ? styles.statusError : toolCall.status === 'pending' ? styles.statusPending : ''}`}
          >
            {displayName}
          </code>
        </button>

        <dialog
          ref={dialogRef}
          className={styles.dialog}
          onClick={handleBackdropClick}
        >
          <div className={styles.dialogContent}>
            <div className={styles.dialogHeader}>
              <code className={styles.dialogTitle}>{displayName}</code>
              <button type="button" className={styles.closeBtn} onClick={closeDialog}>
                ✕
              </button>
            </div>
            <div className={styles.dialogBody}>
              {toolCall.arguments && (
                <div className={styles.section}>
                  <div className={styles.label}>参数</div>
                  <pre className={styles.code}>{formatJson(toolCall.arguments)}</pre>
                </div>
              )}
              {toolCall.result !== undefined && (
                <div className={styles.section}>
                  <div className={styles.label}>结果</div>
                  <pre className={styles.code}>{formatJson(toolCall.result)}</pre>
                </div>
              )}
            </div>
          </div>
        </dialog>
      </>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.toolCall.id === nextProps.toolCall.id &&
      prevProps.toolCall.status === nextProps.toolCall.status &&
      prevProps.toolCall.result === nextProps.toolCall.result
    );
  }
);
