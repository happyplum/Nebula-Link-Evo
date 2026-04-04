import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useTaskHistory } from '../api/history.queries.js';
import { apiClient } from '@/shared/api/client.js';
import { debugTaskDetail } from '@/shared/api/endpoints.js';
import { queryKeys } from '@/shared/query/query-keys.js';
import { testIds } from '@/shared/testing/testids.js';
import type { TaskDetail } from '../types/index.js';
import styles from './DecisionsView.module.css';

function statusClass(status: string): string {
  switch (status) {
    case 'completed':
      return styles.taskStatusCompleted;
    case 'running':
      return styles.taskStatusRunning;
    case 'failed':
      return styles.taskStatusFailed;
    default:
      return styles.taskStatusDefault;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return '完成';
    case 'running':
      return '运行中';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

export function DecisionsView() {
  const { data: taskData, isLoading } = useTaskHistory(20);
  const tasks = taskData?.tasks ?? [];

  const detailQueries = useQueries({
    queries: tasks.map((task) => ({
      queryKey: queryKeys.tasks.detail(task.taskId),
      queryFn: () => apiClient.get<TaskDetail>(debugTaskDetail(task.taskId)),
      enabled: !!task.taskId,
    })),
  });

  const enrichedTasks = useMemo(() => {
    const result: { task: (typeof tasks)[number]; detail?: TaskDetail }[] = [];
    for (let i = 0; i < tasks.length; i++) {
      result.push({ task: tasks[i], detail: detailQueries[i]?.data });
    }
    return result;
  }, [tasks, detailQueries]);

  if (isLoading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>加载中...</div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty} data-testid={testIds.historyShellDecisionsEmpty}>
          暂无决策记录
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {enrichedTasks.map(({ task, detail }) => (
        <div key={task.taskId} className={styles.taskGroup}>
          <div className={styles.taskHeader}>
            <span className={styles.taskInstruction} title={task.instruction}>
              {task.instruction}
            </span>
            <span className={`${styles.taskStatus} ${statusClass(task.status)}`}>
              {statusLabel(task.status)}
            </span>
          </div>

          {detail?.steps && detail.steps.length > 0 && (
            <ul className={styles.stepList}>
              {detail.steps.map((step) => (
                <li key={step.step} className={styles.stepItem}>
                  <span
                    className={`${styles.stepIndicator} ${step.success ? styles.stepSuccess : styles.stepFailure}`}
                  />
                  <span className={styles.stepNumber}>#{step.step}</span>
                  <span className={styles.stepAction}>{step.action.type}</span>
                  <span className={styles.stepMessage}>{step.message}</span>
                </li>
              ))}
            </ul>
          )}

          {detail?.result && (
            <div className={styles.taskResult}>结果: {detail.result}</div>
          )}
          {detail?.error && (
            <div className={`${styles.taskResult} ${styles.taskError}`}>
              错误: {detail.error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
