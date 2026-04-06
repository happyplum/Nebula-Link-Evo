import { useMemo } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import { useInteractions, useTaskDetail } from '../api/history.queries.js';
import { useExecutionStore } from '../store.js';
import type { InteractionFilters } from '../types/index.js';
import { InteractionsTable } from './InteractionsTable.js';
import styles from './ActionStreamPane.module.css';

interface ActionStreamPaneProps {
  filters: InteractionFilters;
}

export function ActionStreamPane({ filters }: ActionStreamPaneProps) {
  const selectedTaskId = useExecutionStore((state) => state.selectedTaskId);
  const { data: task } = useTaskDetail(selectedTaskId ?? '');

  const scopedFilters = useMemo<InteractionFilters>(() => {
    const nextFilters: InteractionFilters = { ...filters };
    if (task?.startTime) {
      const taskStartTime = new Date(task.startTime).getTime();
      nextFilters.startTime = filters.startTime
        ? Math.max(filters.startTime, taskStartTime)
        : taskStartTime;
    }
    return nextFilters;
  }, [filters, task?.startTime]);

  const interactionsQuery = useInteractions(scopedFilters);
  const interactions = interactionsQuery.data?.data ?? [];

  const filteredSummary = useMemo(() => {
    const success = interactions.filter((item) => item.success).length;
    return {
      total: interactions.length,
      success,
      failure: interactions.length - success,
    };
  }, [interactions]);

  return (
    <div className={styles.panel} data-testid={testIds.executionShellActionStream}>
      {selectedTaskId && task?.startTime ? (
        <div className={styles.scopeChip}>按任务时间窗过滤（近似）</div>
      ) : null}

      <div className={styles.summaryStrip}>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>总数</span>
          <strong className={styles.summaryValue}>{filteredSummary.total}</strong>
        </span>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>成功</span>
          <strong className={`${styles.summaryValue} ${styles.success}`}>
            {filteredSummary.success}
          </strong>
        </span>
        <span className={styles.summaryItem}>
          <span className={styles.summaryLabel}>失败</span>
          <strong className={`${styles.summaryValue} ${styles.error}`}>
            {filteredSummary.failure}
          </strong>
        </span>
      </div>

      <div className={styles.tableRegion}>
        <InteractionsTable
          interactions={interactions}
          isLoading={interactionsQuery.isLoading}
          error={interactionsQuery.error as Error | null}
        />
      </div>
    </div>
  );
}
