import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import type { ConnectionStatus, ServiceStatus } from '@/features/runtime/store/runtime.store.js';
import styles from './MonitorSidebarShell.module.css';

const CONNECTION_STATUS_MAP: Record<ConnectionStatus, StatusIndicatorProps['status']> = {
  connected: 'online',
  disconnected: 'offline',
  connecting: 'loading',
  reconnecting: 'loading',
};

const CONNECTION_LABEL_MAP: Record<ConnectionStatus, string> = {
  connected: '已连接',
  disconnected: '未连接',
  connecting: '连接中...',
  reconnecting: '重连中...',
};

const PLAYWRIGHT_STATUS_MAP: Record<ServiceStatus, StatusIndicatorProps['status']> = {
  ready: 'online',
  unhealthy: 'error',
  unknown: 'offline',
};

const PLAYWRIGHT_LABEL_MAP: Record<ServiceStatus, string> = {
  ready: '就绪',
  unhealthy: '异常',
  unknown: '未知',
};

type StatusIndicatorProps = Parameters<typeof StatusIndicator>[0];

export function MonitorSidebarShell() {
  const connectionStatus = useRuntimeStore((s) => s.connectionStatus);
  const playwrightStatus = useRuntimeStore((s) => s.playwrightStatus);
  const snapshotVersion = useRuntimeStore((s) => s.snapshotVersion);
  const incrementSnapshotVersion = useRuntimeStore((s) => s.incrementSnapshotVersion);

  const handleWsRefresh = () => {
    useRuntimeStore.getState().setConnectionStatus('disconnected');
  };

  const handleStep = () => {
    incrementSnapshotVersion();
  };

  const handlePause = () => {
    // Pause handled by WS message — caller wires sendMessage
  };

  const handleResume = () => {
    // Resume handled by WS message — caller wires sendMessage
  };

  const handleBrowserScreenshot = () => {
    incrementSnapshotVersion();
  };

  const handleRefreshDom = () => {
    incrementSnapshotVersion();
  };

  return (
    <div className={styles.shell} data-testid={testIds.monitorSidebar}>
      {/* Card 1: WebSocket Status */}
      <div className={styles.card} data-testid={testIds.monitorSidebarWsCard}>
        <h3 className={styles.cardTitle}>WebSocket 状态</h3>
        <div className={styles.statusRow}>
          <StatusIndicator
            status={CONNECTION_STATUS_MAP[connectionStatus]}
            size="sm"
          />
          <span
            className={styles.statusText}
            data-testid={testIds.monitorSidebarWsStatusText}
          >
            {CONNECTION_LABEL_MAP[connectionStatus]}
          </span>
        </div>
        <div className={styles.buttonRow}>
          <button
            type="button"
            className={styles.btn}
            data-testid={testIds.monitorSidebarWsRefreshBtn}
            onClick={handleWsRefresh}
          >
            刷新连接
          </button>
          <button
            type="button"
            className={styles.btn}
            data-testid={testIds.monitorSidebarWsStepBtn}
            onClick={handleStep}
          >
            单步执行
          </button>
          <button
            type="button"
            className={styles.btn}
            data-testid={testIds.monitorSidebarWsPauseBtn}
            onClick={handlePause}
          >
            暂停任务
          </button>
          <button
            type="button"
            className={styles.btn}
            data-testid={testIds.monitorSidebarWsResumeBtn}
            onClick={handleResume}
          >
            恢复任务
          </button>
        </div>
      </div>

      {/* Card 2: Browser Status */}
      <div className={styles.card} data-testid={testIds.monitorSidebarBrowserCard}>
        <h3 className={styles.cardTitle}>浏览器状态</h3>
        <div className={styles.statusRow}>
          <StatusIndicator
            status={PLAYWRIGHT_STATUS_MAP[playwrightStatus]}
            size="sm"
          />
          <span
            className={styles.statusText}
            data-testid={testIds.monitorSidebarBrowserStatusText}
          >
            {PLAYWRIGHT_LABEL_MAP[playwrightStatus]}
          </span>
        </div>
        <button
          type="button"
          className={styles.btnFull}
          data-testid={testIds.monitorSidebarBrowserScreenshotBtn}
          onClick={handleBrowserScreenshot}
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
          快照版本: {snapshotVersion || '—'}
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
          onClick={handleRefreshDom}
        >
          刷新DOM
        </button>
      </div>
    </div>
  );
}
