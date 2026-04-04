import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTaskHistory } from '../api/history.queries.js';
import { apiClient } from '@/shared/api/client.js';
import { debugTaskDetail } from '@/shared/api/endpoints.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import { formatTime } from '@/shared/lib/date.js';
import { testIds } from '@/shared/testing/testids.js';
import type { TaskDetail, TaskStep } from '../types/index.js';
import styles from './LogsView.module.css';

interface LogEntry {
  taskId: string;
  step: TaskStep;
}

export function LogsView() {
  const { data: taskData, isLoading } = useTaskHistory(20);
  const tasks = taskData?.tasks ?? [];

  const detailQueries = useQueries({
    queries: tasks.map((task) => ({
      queryKey: queryKeys.tasks.detail(task.taskId),
      queryFn: () => apiClient.get<TaskDetail>(debugTaskDetail(task.taskId)),
      enabled: !!task.taskId,
    })),
  });

  const entries = useMemo<LogEntry[]>(() => {
    const all: LogEntry[] = [];
    for (let i = 0; i < tasks.length; i++) {
      const detail = detailQueries[i]?.data;
      if (detail?.steps) {
        for (const step of detail.steps) {
          all.push({ taskId: tasks[i].taskId, step });
        }
      }
    }
    all.sort(
      (a, b) => new Date(a.step.timestamp).getTime() - new Date(b.step.timestamp).getTime(),
    );
    return all;
  }, [tasks, detailQueries]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>加载中...</div>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty} data-testid={testIds.historyShellLogsEmpty}>
          暂无日志记录
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {entries.map((entry) => (
        <div key={`${entry.taskId}-${entry.step.step}`} className={styles.entry}>
          <span
            className={`${styles.indicator} ${entry.step.success ? styles.success : styles.failure}`}
          />
          <span className={styles.timestamp}>{formatTime(entry.step.timestamp)}</span>
          <span className={styles.stepLabel}>Step {entry.step.step}:</span>
          <span className={styles.message}>{entry.step.message}</span>
        </div>
      ))}
    </div>
  );
}
