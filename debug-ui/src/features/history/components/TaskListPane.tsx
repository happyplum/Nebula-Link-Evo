import { formatDateTime } from '@/shared/lib/date.js';
import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useTaskHistory } from '../api/history.queries.js';
import { useExecutionStore } from '../store.js';
import styles from './TaskListPane.module.css';

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

export function TaskListPane() {
  const setSelectedTaskId = useExecutionStore((state) => state.setSelectedTaskId);
  const { data, isLoading, error } = useTaskHistory(50);
  const tasks = data?.tasks ?? [];

  if (isLoading) {
    return (
      <div className={styles.state}>
        <StatusIndicator status="loading" label="加载任务列表..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.state}>
        <StatusIndicator status="error" label="任务列表加载失败" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.empty} data-testid={testIds.executionShellTaskListEmpty}>
        暂无任务记录
      </div>
    );
  }

  return (
    <div className={styles.wrapper} data-testid={testIds.executionShellTaskList}>
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
            >
              <td className={styles.instructionCell} title={task.instruction}>
                {task.instruction}
              </td>
              <td>
                <span className={`${styles.badge} ${getStatusClass(task.status)}`}>
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
  );
}
