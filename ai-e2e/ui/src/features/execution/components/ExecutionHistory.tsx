import React from 'react';
import { Card } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import styles from './ExecutionHistory.module.css';

interface ExecutionHistoryProps {
  runs: ExecutionRun[];
}

export const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({ runs }) => {
  // Sort runs by started_at descending
  const sortedRuns = [...runs].sort((a, b) => 
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  return (
    <Card title="执行历史">
      <div className={styles.container}>
        {sortedRuns.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: 'var(--spacing-4)' }}>
            暂无执行历史
          </div>
        ) : (
          <div className={styles.timeline}>
            {sortedRuns.map((run) => (
              <div key={run.id} className={styles.timelineItem}>
                <div className={`${styles.timelineDot} ${styles[run.status]}`} />
                <div className={styles.timelineContent}>
                  <div className={styles.timelineHeader}>
                    <div className={styles.timelineTitle}>{run.script_name}</div>
                    <div className={styles.timelineTime}>
                      {new Date(run.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div className={styles.timelineBody}>
                    状态: {run.status}
                    {run.duration_ms && ` · 耗时: ${(run.duration_ms / 1000).toFixed(1)}s`}
                    {run.ai_fix_applied && ' · AI 修复已采纳'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
