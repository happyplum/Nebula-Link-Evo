import { useEffect, useRef } from 'react';
import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import { useControlStore } from '../store/control.store.js';
import styles from './OperationLogsShell.module.css';

export interface OperationLogsShellProps {
  /** Whether the accordion is expanded. */
  open: boolean;
  /** Toggle callback — parent controls open state. */
  onToggle: () => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

export function OperationLogsShell({ open, onToggle }: OperationLogsShellProps) {
  const consoleMessages = useControlStore((s) => s.consoleMessages);
  const setConsoleMessages = useControlStore((s) => s.setConsoleMessages);
  const logContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  });

  const getLevelClassName = (type: string) => {
    switch (type) {
      case 'success':
        return styles.levelSuccess;
      case 'warning':
        return styles.levelWarning;
      case 'error':
        return styles.levelError;
      default:
        return styles.levelInfo;
    }
  };

  const handleClear = () => {
    setConsoleMessages([]);
  };

  return (
    <Accordion
      open={open}
      onToggle={onToggle}
      title="📝 操作日志"
      testId={testIds.controlOperationLogs}
    >
      <div
        className={styles.logContainer}
        ref={logContainerRef}
        data-testid={testIds.controlOperationLogsContainer}
      >
        {consoleMessages.length === 0 ? (
          <p className={styles.emptyState}>暂无日志</p>
        ) : (
          consoleMessages.map((msg) => (
            <div key={msg.timestamp} className={styles.logEntry}>
              <span className={styles.logTimestamp}>[{formatTime(msg.timestamp)}]</span>
              <span className={`${styles.logLevel} ${getLevelClassName(msg.type)}`}>
                {msg.type}
              </span>
              <span className={styles.logText}>{msg.text}</span>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        className={styles.clearButton}
        onClick={handleClear}
        data-testid={testIds.controlOperationLogsClearBtn}
      >
        清空日志
      </button>
    </Accordion>
  );
}
