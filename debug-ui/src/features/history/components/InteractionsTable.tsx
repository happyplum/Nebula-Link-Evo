import { useState } from 'react';
import { formatTime, formatDuration } from '@/shared/lib/date.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { testIds } from '@/shared/testing/testids.js';
import { InteractionDetailModal } from './InteractionDetailModal.js';
import type { Interaction } from '../types/index.js';
import styles from './InteractionsTable.module.css';

export interface InteractionsTableProps {
  interactions: Interaction[];
  isLoading: boolean;
  error: Error | null;
}

export function InteractionsTable({ interactions, isLoading, error }: InteractionsTableProps) {
  const [selectedInteraction, setSelectedInteraction] = useState<Interaction | null>(null);

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <StatusIndicator status="loading" label="加载中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.error}>
        <StatusIndicator status="error" label="加载失败" />
      </div>
    );
  }

  if (interactions.length === 0) {
    return <div className={styles.empty}>暂无交互记录</div>;
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container} data-testid={testIds.interactionsTable}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>时间</th>
              <th>操作</th>
              <th>目标</th>
              <th>定位器</th>
              <th>状态</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            {interactions.map((interaction) => (
              <tr
                key={interaction.id}
                className={styles.row}
                onClick={() => setSelectedInteraction(interaction)}
                data-testid={testIds.interactionsTableRow}
              >
                <td className={styles.timeCell}>{formatTime(interaction.timestamp)}</td>
                <td>
                  <span className={styles.actionBadge}>{interaction.action_type}</span>
                </td>
                <td className={styles.targetCell}>{interaction.target_type}</td>
                <td className={styles.locatorCell}>{interaction.locator_strategy || '-'}</td>
                <td>
                  <span className={`${styles.statusBadge} ${interaction.success ? styles.success : styles.error}`}>
                    {interaction.success ? '成功' : '失败'}
                  </span>
                </td>
                <td className={styles.latencyCell}>
                  {interaction.latency_ms != null ? formatDuration(interaction.latency_ms) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <InteractionDetailModal
        interaction={selectedInteraction}
        onClose={() => setSelectedInteraction(null)}
      />
    </div>
  );
}
