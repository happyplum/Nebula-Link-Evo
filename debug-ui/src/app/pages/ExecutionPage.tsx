import { useMemo, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExecutionShell } from '@/features/history/components/index.js';
import { useInteractionStats, useInteractions } from '@/features/history/api/history.queries.js';
import { useExecutionStore } from '@/features/history/store.js';
import type { Interaction, InteractionFilters } from '@/features/history/types/index.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './ExecutionPage.module.css';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'failure', label: '失败' },
] as const;

function statusToSuccessFilter(value: string): boolean | undefined {
  if (value === 'success') return true;
  if (value === 'failure') return false;
  return undefined;
}

function successFilterToStatus(value?: boolean): string {
  if (value === true) return 'success';
  if (value === false) return 'failure';
  return 'all';
}

function toDateInputValue(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function deriveActionTypeOptions(byActionType?: Record<string, number>): string[] {
  if (!byActionType) return [];
  return Object.entries(byActionType)
    .sort(([, left], [, right]) => right - left)
    .map(([type]) => type);
}

function deriveLocatorOptions(interactions: Pick<Interaction, 'locator_strategy'>[]): string[] {
  return [...new Set(interactions.map((item) => item.locator_strategy).filter(Boolean))].sort();
}

export default function ExecutionPage() {
  const navigate = useNavigate();
  const filters = useExecutionStore((state) => state.interactionFilters);
  const setInteractionFilters = useExecutionStore((state) => state.setInteractionFilters);
  const resetInteractionFilters = useExecutionStore((state) => state.resetInteractionFilters);
  const sidebarCollapsed = useExecutionStore((state) => state.statsOverlayOpen);
  const setSidebarCollapsed = useExecutionStore((state) => state.setStatsOverlayOpen);

  const statsQuery = useInteractionStats();
  const locatorDiscoveryFilters = useMemo<InteractionFilters>(
    () => ({ ...filters, locatorStrategy: undefined, limit: 200, offset: 0 }),
    [filters]
  );
  const interactionsQuery = useInteractions(locatorDiscoveryFilters);

  const actionTypeOptions = useMemo(
    () => deriveActionTypeOptions(statsQuery.data?.data.by_action_type),
    [statsQuery.data?.data.by_action_type]
  );
  const locatorOptions = useMemo(
    () => deriveLocatorOptions(interactionsQuery.data?.data ?? []),
    [interactionsQuery.data?.data]
  );

  const handleStatusChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setInteractionFilters({ success: statusToSuccessFilter(event.target.value) });
  };

  const handleActionTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setInteractionFilters({ actionType: event.target.value || undefined });
  };

  const handleLocatorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setInteractionFilters({ locatorStrategy: event.target.value || undefined });
  };

  const handleDateStartChange = (event: ChangeEvent<HTMLInputElement>) => {
    setInteractionFilters({
      startTime: event.target.value
        ? new Date(`${event.target.value}T00:00:00`).getTime()
        : undefined,
    });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button type="button" className={styles.backButton} onClick={() => navigate('/')}>
          ← 返回调试
        </button>
        <div className={styles.headerText}>
          <h1 className={styles.title}>🌌 Nebula Debug · 执行记录</h1>
          <p className={styles.subtitle}>以全页仪表盘视图统一追踪任务与交互执行表现</p>
        </div>
      </header>

      <div className={styles.body}>
        <aside
          className={`${styles.filterSidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}
        >
          <div className={styles.sidebarHeader}>
            <div>
              <p className={styles.sidebarEyebrow}>全局筛选</p>
              <h2 className={styles.sidebarTitle}>过滤条件</h2>
            </div>
            <button
              type="button"
              className={styles.sidebarToggle}
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarCollapsed ? '展开筛选侧栏' : '收起筛选侧栏'}
            >
              {sidebarCollapsed ? '→' : '←'}
            </button>
          </div>

          <div className={styles.filterStack}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>状态</span>
              <select
                className={styles.select}
                value={successFilterToStatus(filters.success)}
                onChange={handleStatusChange}
                data-testid={testIds.executionShellFilterStatus}
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>操作类型</span>
              <select
                className={styles.select}
                value={filters.actionType ?? ''}
                onChange={handleActionTypeChange}
                data-testid={testIds.executionShellFilterType}
              >
                <option value="">全部操作</option>
                {actionTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>定位策略</span>
              <select
                className={styles.select}
                value={filters.locatorStrategy ?? ''}
                onChange={handleLocatorChange}
                data-testid={testIds.executionShellFilterLocator}
              >
                <option value="">全部定位器</option>
                {locatorOptions.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>起始日期</span>
              <input
                type="date"
                className={styles.dateInput}
                value={toDateInputValue(filters.startTime)}
                onChange={handleDateStartChange}
                data-testid={testIds.executionShellFilterDateStart}
              />
            </label>

            <button type="button" className={styles.resetButton} onClick={resetInteractionFilters}>
              重置筛选
            </button>
          </div>
        </aside>

        <main className={styles.mainContent}>
          <ExecutionShell filters={filters} />
        </main>
      </div>
    </div>
  );
}
