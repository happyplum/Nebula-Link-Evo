import { useState } from 'react';
import { useTaskHistory } from '../api/history.queries.js';
import { formatDateTime } from '@/shared/lib/date.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { testIds } from '@/shared/testing/testids.js';
import { TaskDetailModal } from './TaskDetailModal.js';
import styles from './HistoryTable.module.css';

export interface HistoryTableProps {
  limit?: number;
}

export function HistoryTable({ limit = 50 }: HistoryTableProps) {
  const { data, isLoading, error } = useTaskHistory(limit);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <StatusIndicator status="loading" label="Loading history..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <StatusIndicator status="error" label="Failed to load history" />
      </div>
    );
  }

  const tasks = data?.tasks || [];

  if (tasks.length === 0) {
    return <div className={styles.empty} data-testid={testIds.historyShellTasksEmpty}>暂无任务记录</div>;
  }

  return (
    <>
      <div className={styles.container} data-testid="history-table">
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Instruction</th>
              <th>Status</th>
              <th>Start Time</th>
              <th>Steps</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr
                key={task.taskId}
                className={styles.row}
                onClick={() => setSelectedTaskId(task.taskId)}
                data-testid="history-table-row"
              >
                <td className={styles.instructionCell}>
                  <div className={styles.instruction} title={task.instruction}>
                    {task.instruction.length > 50
                      ? `${task.instruction.substring(0, 50)}...`
                      : task.instruction}
                  </div>
                </td>
                <td>
                  <span className={`${styles.badge} ${styles[task.status] || ''}`}>
                    {task.status}
                  </span>
                </td>
                <td className={styles.timeCell}>{formatDateTime(task.startTime)}</td>
                <td className={styles.stepCell}>{task.stepCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TaskDetailModal
        taskId={selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
      />
    </>
  );
}
