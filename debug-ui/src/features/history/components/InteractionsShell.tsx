import { testIds } from '@/shared/testing/testids.js';
import styles from './InteractionsShell.module.css';

const STATUS_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'failure', label: '失败' },
  { value: 'running', label: '进行中' },
] as const;

export function InteractionsShell() {
  return (
    <div className={styles.shell} data-testid={testIds.interactionsShell}>
      {/* Filter Rail */}
      <div className={styles.filterRail} data-testid={testIds.interactionsShellFilterRail}>
        <select
          className={styles.filterSelect}
          data-testid={testIds.interactionsShellFilterStatus}
          disabled
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
          disabled
        >
          <option value="all">全部类型</option>
        </select>
        <input
          type="date"
          className={styles.filterDateInput}
          data-testid={testIds.interactionsShellFilterDateStart}
          disabled
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
          <span className={styles.statValue}>0</span>
        </span>
        <span className={styles.statItem} data-testid={testIds.interactionsShellStatsSuccess}>
          <span className={styles.statLabel}>成功:</span>
          <span className={styles.statValue}>0</span>
        </span>
        <span className={styles.statItem} data-testid={testIds.interactionsShellStatsFailure}>
          <span className={styles.statLabel}>失败:</span>
          <span className={styles.statValue}>0</span>
        </span>
      </div>

      {/* Table Region */}
      <div className={styles.tableRegion} data-testid={testIds.interactionsShellTableRegion}>
        <div className={styles.tableEmpty} data-testid={testIds.interactionsShellTableEmpty}>
          等待数据...
        </div>
      </div>

      {/* Modal Anchor — hidden slot for detail modal */}
      <div
        className={styles.modalAnchor}
        data-testid={testIds.interactionsShellModalAnchor}
      />
    </div>
  );
}
