import { useCallback, useEffect, useRef, useState } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import type { ConnectionStatus, ServiceStatus } from '@/features/runtime/store/runtime.store.js';
import { useDebugSocket } from '@/features/runtime/hooks/useDebugSocket.js';
import styles from './MonitorMainShell.module.css';

const CONNECTION_LABEL: Record<ConnectionStatus, string> = {
  connected: '已连接',
  disconnected: '未连接',
  connecting: '连接中...',
  reconnecting: '重连中...',
};

const TASK_STATUS_LABEL: Record<ServiceStatus, string> = {
  ready: '就绪',
  unhealthy: '异常',
  unknown: '空闲',
};

interface LogEntry {
  id: number;
  timestamp: number;
  type: string;
  message: string;
}

let nextLogId = 0;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const MAX_LOG_ENTRIES = 200;
const SILENT_TYPES = new Set(['ping', 'pong', 'ack']);

export function MonitorMainShell() {
  const connectionStatus = useRuntimeStore((s) => s.connectionStatus);
  const playwrightStatus = useRuntimeStore((s) => s.playwrightStatus);
  const snapshotVersion = useRuntimeStore((s) => s.snapshotVersion);
  const lastScreenshotDataUrl = useRuntimeStore((s) => s.lastScreenshotDataUrl);
  const incrementSnapshotVersion = useRuntimeStore((s) => s.incrementSnapshotVersion);

  const { sendMessage, onMessage } = useDebugSocket();
  const isConnected = connectionStatus === 'connected';

  const [commandInput, setCommandInput] = useState('');
  const commandInputRef = useRef<HTMLInputElement>(null);

  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to WS messages → execution log
  useEffect(() => {
    const unsubscribe = onMessage((data: unknown) => {
      const msg = data as { type?: string; message?: string; [k: string]: unknown };
      if (!msg || typeof msg.type !== 'string') return;
      if (SILENT_TYPES.has(msg.type)) return;

      const message =
        typeof msg.message === 'string'
          ? msg.message
          : JSON.stringify(msg).substring(0, 120);

      setLogEntries((prev) => {
        const next = [
          ...prev,
          { id: nextLogId++, timestamp: Date.now(), type: msg.type!, message },
        ];
        return next.length > MAX_LOG_ENTRIES ? next.slice(-MAX_LOG_ENTRIES) : next;
      });
    });
    return unsubscribe;
  }, [onMessage]);

  // Auto-scroll log to bottom on new entries
  const logCountRef = useRef(0);
  logCountRef.current = logEntries.length;
  useEffect(() => {
    if (logCountRef.current > 0) {
      const el = logContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  const handleStep = useCallback(() => {
    sendMessage('step', { taskId: undefined });
  }, [sendMessage]);

  const handleFocusCommand = useCallback(() => {
    commandInputRef.current?.focus();
  }, []);

  const handleDownload = useCallback(() => {
    if (!lastScreenshotDataUrl) return;
    const a = document.createElement('a');
    a.href = lastScreenshotDataUrl;
    a.download = `screenshot-${Date.now()}.png`;
    a.click();
  }, [lastScreenshotDataUrl]);

  const handleRefresh = useCallback(() => {
    incrementSnapshotVersion();
  }, [incrementSnapshotVersion]);

  const handleExecute = useCallback(() => {
    const trimmed = commandInput.trim();
    if (!trimmed || !isConnected) return;

    const cmd = trimmed.split(' ')[0];
    if (cmd === 'pause') sendMessage('pause');
    else if (cmd === 'resume') sendMessage('resume');
    else if (cmd === 'step') sendMessage('step');
    else sendMessage('command', { command: trimmed });

    setCommandInput('');
  }, [commandInput, isConnected, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute],
  );

  const badgeClass = isConnected ? `${styles.statusBadge} ${styles.connected}` : styles.statusBadge;
  const indicatorClass =
    playwrightStatus === 'ready' ? `${styles.taskIndicator} ${styles.ready}` : styles.taskIndicator;

  return (
    <div className={styles.shell} data-testid={testIds.monitorMain}>
      {/* Header */}
      <div className={styles.header} data-testid={testIds.monitorMainHeader}>
        <h2 className={styles.headerTitle}>📸 实时监控</h2>
        <span className={badgeClass} data-testid={testIds.monitorMainStatusBadge}>
          <span className={`${styles.statusDot}${isConnected ? ` ${styles.statusDotOnline}` : ''}`} />
          {CONNECTION_LABEL[connectionStatus]}
        </span>
      </div>

      {/* LiveViewCanvas slot */}
      <div className={styles.liveviewContainer} data-testid={testIds.monitorMainLiveview}>
        <div className={styles.liveviewHeader}>
          实时画面
          <span className={styles.liveviewHeaderSub}>
            {snapshotVersion > 0 ? `v${snapshotVersion}` : '—'}
          </span>
        </div>
      </div>

      {/* Task Strip */}
      <div className={styles.taskStrip} data-testid={testIds.monitorMainTaskStrip}>
        <span className={indicatorClass} data-testid={testIds.monitorMainTaskIndicator} />
        <span className={styles.taskStatusText} data-testid={testIds.monitorMainTaskStatusText}>
          {TASK_STATUS_LABEL[playwrightStatus]}
        </span>
        <span className={styles.taskId} data-testid={testIds.monitorMainTaskId}>
          {snapshotVersion > 0 ? `#${snapshotVersion}` : '—'}
        </span>
      </div>

      {/* Quick Actions */}
      <div className={styles.quickActions} data-testid={testIds.monitorMainQuickActions}>
        <button
          type="button"
          className={`${styles.actionBtn}${!isConnected ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainStepBtn}
          onClick={handleStep}
          disabled={!isConnected}
        >
          ⏯ 单步执行
        </button>
        <button
          type="button"
          className={`${styles.actionBtn}${!isConnected ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainSendCmdBtn}
          onClick={handleFocusCommand}
          disabled={!isConnected}
        >
          💬 发送指令
        </button>
        <button
          type="button"
          className={`${styles.actionBtn}${!isConnected || !lastScreenshotDataUrl ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainDownloadBtn}
          onClick={handleDownload}
          disabled={!isConnected || !lastScreenshotDataUrl}
        >
          📸 下载截图
        </button>
        <button
          type="button"
          className={`${styles.actionBtn}${!isConnected ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainRefreshBtn}
          onClick={handleRefresh}
          disabled={!isConnected}
        >
          🔄 刷新历史
        </button>
      </div>

      {/* Command Bar */}
      <div className={styles.commandBar} data-testid={testIds.monitorMainCommandBar}>
        <input
          ref={commandInputRef}
          type="text"
          className={styles.commandInput}
          placeholder="输入指令 (pause/resume/step)..."
          data-testid={testIds.monitorMainCommandInput}
          value={commandInput}
          onChange={(e) => setCommandInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!isConnected}
        />
        <button
          type="button"
          className={`${styles.executeBtn}${!isConnected ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainExecuteBtn}
          onClick={handleExecute}
          disabled={!isConnected}
        >
          执行
        </button>
      </div>

      {/* Execution Log */}
      <div className={styles.logPanel} data-testid={testIds.monitorMainLogPanel}>
        <div className={styles.logHeader}>执行日志</div>
        <div
          className={styles.logContainer}
          ref={logContainerRef}
          data-testid={testIds.monitorMainLogContainer}
        >
          {logEntries.length === 0 ? (
            <div className={styles.logEmpty} data-testid={testIds.monitorMainLogEmpty}>
              等待日志...
            </div>
          ) : (
            logEntries.map((entry) => (
              <div key={entry.id} className={styles.logEntry}>
                [{formatTime(entry.timestamp)}] {entry.type}: {entry.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
