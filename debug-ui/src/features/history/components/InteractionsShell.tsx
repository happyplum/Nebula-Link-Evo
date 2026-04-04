import { useMemo, type ChangeEvent } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import { useInteractionFilters } from '../hooks/useInteractionFilters.js';
import { useInteractions, useInteractionStats } from '../api/history.queries.js';
import type { Interaction } from '../types/index.js';
import { InteractionsTable } from './InteractionsTable.js';
import styles from './InteractionsShell.module.css';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'failure', label: '失败' },
  { value: 'running', label: '进行中' },
] as const;

/** Map status select value to InteractionFilters.success. */
function statusToSuccessFilter(value: string): boolean | undefined {
  if (value === 'success') return true;
  if (value === 'failure') return false;
  return undefined;
}

/** Derive action-type options from stats `by_action_type` keys. */
function deriveActionTypes(
  byActionType?: Record<string, number>,
): { value: string; label: string }[] {
  if (!byActionType) return [];
  return Object.entries(byActionType)
    .sort(([, a], [, b]) => b - a)
    .map(([type]) => ({ value: type, label: type }));
}

export function InteractionsShell() {
  const { filters, updateFilters } = useInteractionFilters();

  const interactionsQuery = useInteractions(filters);
  const statsQuery = useInteractionStats();

  const interactions = interactionsQuery.data?.data ?? [];
  const stats = statsQuery.data?.data ?? null;

  const actionTypeOptions = useMemo(
    () => deriveActionTypes(stats?.by_action_type),
    [stats?.by_action_type],
  );

  // Computed counts from filtered interactions when no dedicated stats-by-filter exist
  const counts = useMemo(() => {
    if (interactions.length === 0) return { total: 0, success: 0, failure: 0 };
    return {
      total: interactions.length,
      success: interactions.filter((i: Interaction) => i.success).length,
      failure: interactions.filter((i: Interaction) => !i.success).length,
    };
  }, [interactions]);

  const handleStatusChange = (e: ChangeEvent<HTMLSelectElement>) => {
    updateFilters({ success: statusToSuccessFilter(e.target.value) });
  };

  const handleActionTypeChange = (e: ChangeEvent<HTMLSelectElement>) => {
    updateFilters({ actionType: e.target.value || undefined });
  };

  const handleDateStartChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    updateFilters({ startTime: val ? new Date(val).getTime() : undefined });
  };

  return (
    <div className={styles.shell} data-testid={testIds.interactionsShell}>
      {/* Filter Rail */}
      <div className={styles.filterRail} data-testid={testIds.interactionsShellFilterRail}>
        <select
          className={styles.filterSelect}
          data-testid={testIds.interactionsShellFilterStatus}
          defaultValue="all"
          onChange={handleStatusChange}
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          data-testid={testIds.interactionsShellFilterType}
          defaultValue=""
          onChange={handleActionTypeChange}
        >
          <option value="">全部类型</option>
          {actionTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <input
          type="date"
          className={styles.filterDateInput}
          data-testid={testIds.interactionsShellFilterDateStart}
          onChange={handleDateStartChange}
        />
        <input
          type="date"
          className={styles.filterDateInput}
          data-testid={testIds.interactionsShellFilterDateEnd}
          disabled
        />
      </div>

      {/* Stats Strip */}
      <div className={styles.statsStrip} data-testid={testIds.interactionsShellStatsStrip}>
        <span className={styles.statItem} data-testid={testIds.interactionsShellStatsTotal}>
          <span className={styles.statLabel}>总计:</span>
          <span className={styles.statValue}>{stats?.total ?? counts.total}</span>
        </span>
        <span className={styles.statItem} data-testid={testIds.interactionsShellStatsSuccess}>
          <span className={styles.statLabel}>成功:</span>
          <span className={styles.statValue}>{stats?.success_count ?? counts.success}</span>
        </span>
        <span className={styles.statItem} data-testid={testIds.interactionsShellStatsFailure}>
          <span className={styles.statLabel}>失败:</span>
          <span className={styles.statValue}>{stats?.failure_count ?? counts.failure}</span>
        </span>
      </div>

      {/* Table Region */}
      <div className={styles.tableRegion} data-testid={testIds.interactionsShellTableRegion}>
        <InteractionsTable
          interactions={interactions}
          isLoading={interactionsQuery.isLoading}
          error={interactionsQuery.error}
        />
      </div>

      {/* Modal Anchor — hidden slot for detail modal */}
      <div
        className={styles.modalAnchor}
        data-testid={testIds.interactionsShellModalAnchor}
      />
    </div>
  );
}
