import { testIds } from '@/shared/testing/testids.js';
import styles from './MonitorMainShell.module.css';

export function MonitorMainShell() {
  return (
    <div className={styles.shell} data-testid={testIds.monitorMain}>
      {/* Liveview Header */}
      <div className={styles.header} data-testid={testIds.monitorMainHeader}>
        <h2 className={styles.headerTitle}>📸 实时监控</h2>
        <span className={styles.statusBadge} data-testid={testIds.monitorMainStatusBadge}>
          未连接
        </span>
      </div>

      {/* Screenshot Container — LiveViewCanvas slot for Phase 3 */}
      <div className={styles.liveviewContainer} data-testid={testIds.monitorMainLiveview} />

      {/* Task Strip */}
      <div className={styles.taskStrip} data-testid={testIds.monitorMainTaskStrip}>
        <span className={styles.taskIndicator} data-testid={testIds.monitorMainTaskIndicator} />
        <span className={styles.taskStatusText} data-testid={testIds.monitorMainTaskStatusText}>
          空闲
        </span>
        <span className={styles.taskId} data-testid={testIds.monitorMainTaskId}>—</span>
      </div>

      {/* Quick Actions */}
      <div className={styles.quickActions} data-testid={testIds.monitorMainQuickActions}>
        <button type="button" className={styles.actionBtn} data-testid={testIds.monitorMainStepBtn}>
          单步执行
        </button>
        <button type="button" className={styles.actionBtn} data-testid={testIds.monitorMainSendCmdBtn}>
          发送指令
        </button>
        <button type="button" className={styles.actionBtn} data-testid={testIds.monitorMainDownloadBtn}>
          下载截图
        </button>
        <button type="button" className={styles.actionBtn} data-testid={testIds.monitorMainRefreshBtn}>
          刷新历史
        </button>
      </div>

      {/* Command Bar */}
      <div className={styles.commandBar} data-testid={testIds.monitorMainCommandBar}>
        <input
          type="text"
          className={styles.commandInput}
          placeholder="输入指令..."
          data-testid={testIds.monitorMainCommandInput}
        />
        <button type="button" className={styles.executeBtn} data-testid={testIds.monitorMainExecuteBtn}>
          执行
        </button>
      </div>

      {/* Execution Log */}
      <div className={styles.logPanel} data-testid={testIds.monitorMainLogPanel}>
        <div className={styles.logHeader}>执行日志</div>
        <div className={styles.logContainer} data-testid={testIds.monitorMainLogContainer}>
          <div className={styles.logEmpty} data-testid={testIds.monitorMainLogEmpty}>
            等待日志...
          </div>
        </div>
      </div>
    </div>
  );
}
