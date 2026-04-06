import { formatDateTime } from '@/shared/lib/date.js';
import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useTaskDetail } from '../api/history.queries.js';
import { useExecutionStore } from '../store.js';
import styles from './ExecutionContextBar.module.css';

function getStatusClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized.includes('success') || normalized.includes('completed')) return styles.success;
  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('cancel')
  ) {
    return styles.error;
  }
  if (
    normalized.includes('run') ||
    normalized.includes('pending') ||
    normalized.includes('pause')
  ) {
    return styles.running;
  }
  return styles.muted;
}

export function ExecutionContextBar() {
  const selectedTaskId = useExecutionStore((state) => state.selectedTaskId);
  const setSelectedTaskId = useExecutionStore((state) => state.setSelectedTaskId);
  const { data: task, isLoading, error } = useTaskDetail(selectedTaskId ?? '');

  return (
    <div className={styles.bar} data-testid={testIds.executionShellContextBar}>
      <button type="button" className={styles.backButton} onClick={() => setSelectedTaskId(null)}>
        ← 返回
      </button>

      <div className={styles.content}>
        {isLoading ? (
          <StatusIndicator status="loading" label="加载任务上下文..." size="sm" />
        ) : error ? (
          <StatusIndicator status="error" label="任务上下文加载失败" size="sm" />
        ) : task ? (
          <>
            <span className={styles.instruction} title={task.instruction}>
              {task.instruction}
            </span>
            <div className={styles.meta}>
              <span className={`${styles.badge} ${getStatusClass(task.status)}`}>
                {task.status}
              </span>
              <span className={styles.time}>{formatDateTime(task.startTime)}</span>
            </div>
          </>
        ) : (
          <span className={styles.placeholder}>未找到任务上下文</span>
        )}
      </div>
    </div>
  );
}
