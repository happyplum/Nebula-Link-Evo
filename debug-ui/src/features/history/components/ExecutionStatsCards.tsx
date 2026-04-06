import { formatDuration } from '@/shared/lib/date.js';
import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useInteractionStats } from '../api/history.queries.js';
import styles from './ExecutionStatsCards.module.css';

function formatRate(rate?: number): string {
  if (rate == null || Number.isNaN(rate)) return '--';
  return `${Math.round(rate * 100)}%`;
}

function formatLatency(latency?: number): string {
  if (latency == null || Number.isNaN(latency)) return '--';
  if (latency <= 0) return '0 ms';
  return formatDuration(latency);
}

export function ExecutionStatsCards() {
  const { data, isLoading, error } = useInteractionStats();
  const stats = data?.data;

  if (isLoading) {
    return (
      <div className={styles.loading}>
        <StatusIndicator status="loading" label="加载统计中..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.loading}>
        <StatusIndicator status="error" label="统计加载失败" />
      </div>
    );
  }

  return (
    <div className={styles.grid}>
      <article className={styles.card} data-testid={testIds.executionShellStatsTotal}>
        <span className={styles.label}>总交互数</span>
        <strong className={styles.value}>{stats?.total ?? 0}</strong>
      </article>
      <article className={styles.card} data-testid={testIds.executionShellStatsRate}>
        <span className={styles.label}>成功率</span>
        <strong className={styles.value}>{formatRate(stats?.success_rate)}</strong>
      </article>
      <article className={styles.card} data-testid={testIds.executionShellStatsLatency}>
        <span className={styles.label}>平均耗时</span>
        <strong className={styles.value}>{formatLatency(stats?.avg_latency_ms)}</strong>
      </article>
    </div>
  );
}
