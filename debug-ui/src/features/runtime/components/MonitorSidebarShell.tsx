import { testIds } from '@/shared/testing/testids.js';
import styles from './MonitorSidebarShell.module.css';

export function MonitorSidebarShell() {
  return (
    <div className={styles.shell} data-testid={testIds.monitorSidebar}>
      {/* Card 1: WebSocket Status */}
      <div className={styles.card} data-testid={testIds.monitorSidebarWsCard}>
        <h3 className={styles.cardTitle}>WebSocket 状态</h3>
        <div className={styles.statusRow}>
          <span
            className={styles.indicator}
            data-testid={testIds.monitorSidebarWsStatusIndicator}
          />
          <span
            className={styles.statusText}
            data-testid={testIds.monitorSidebarWsStatusText}
          >
            未连接
          </span>
        </div>
        <div className={styles.buttonRow}>
          <button type="button" className={styles.btn} data-testid={testIds.monitorSidebarWsRefreshBtn}>
            刷新
          </button>
          <button type="button" className={styles.btn} data-testid={testIds.monitorSidebarWsStepBtn}>
            单步
          </button>
          <button type="button" className={styles.btn} data-testid={testIds.monitorSidebarWsPauseBtn}>
            暂停
          </button>
          <button type="button" className={styles.btn} data-testid={testIds.monitorSidebarWsResumeBtn}>
            恢复
          </button>
        </div>
      </div>

      {/* Card 2: Browser Status */}
      <div className={styles.card} data-testid={testIds.monitorSidebarBrowserCard}>
        <h3 className={styles.cardTitle}>浏览器状态</h3>
        <div className={styles.statusRow}>
          <span
            className={styles.indicator}
            data-testid={testIds.monitorSidebarBrowserIndicator}
          />
          <span
            className={styles.statusText}
            data-testid={testIds.monitorSidebarBrowserStatusText}
          >
            未连接
          </span>
        </div>
        <button
          type="button"
          className={styles.btnFull}
          data-testid={testIds.monitorSidebarBrowserScreenshotBtn}
        >
          截图
        </button>
      </div>

      {/* Card 3: DOM Screenshot */}
      <div className={styles.card} data-testid={testIds.monitorSidebarScreenshotCard}>
        <h3 className={styles.cardTitle}>DOM 截图</h3>
        <p
          className={styles.statusText}
          data-testid={testIds.monitorSidebarSnapshotLabel}
        >
          快照版本: —
        </p>
        <div
          className={styles.screenshotPlaceholder}
          data-testid={testIds.monitorSidebarSnapshotImg}
        >
          等待截图...
        </div>
        <button
          type="button"
          className={styles.btnFull}
          data-testid={testIds.monitorSidebarSnapshotRefreshBtn}
        >
          刷新DOM
        </button>
      </div>
    </div>
  );
}
