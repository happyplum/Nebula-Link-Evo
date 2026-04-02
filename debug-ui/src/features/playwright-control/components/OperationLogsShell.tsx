import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './OperationLogsShell.module.css';

export interface OperationLogsShellProps {
  /** Whether the accordion is expanded. */
  open: boolean;
  /** Toggle callback — parent controls open state. */
  onToggle: () => void;
}

export function OperationLogsShell({ open, onToggle }: OperationLogsShellProps) {
  return (
    <Accordion
      open={open}
      onToggle={onToggle}
      title="📝 操作日志"
      testId={testIds.controlOperationLogs}
    >
      <div
        className={styles.logContainer}
        data-testid={testIds.controlOperationLogsContainer}
      >
        <p className={styles.emptyState}>等待操作...</p>
      </div>
      <button
        type="button"
        className={styles.clearButton}
        data-testid={testIds.controlOperationLogsClearBtn}
      >
        清空日志
      </button>
    </Accordion>
  );
}
