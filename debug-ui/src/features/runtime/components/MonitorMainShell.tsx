import { useCallback, useEffect, useState } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import {
  LiveKitView,
  LiveViewCanvas,
  TransportToggle,
} from '@/features/liveview/components/index.js';
import {
  useRuntimeStore,
  selectPlaywrightUrl,
  selectLiveviewTransport,
  selectPlaywrightIsOpen,
  type ServiceStatus,
} from '@/features/runtime/store/runtime.store.js';
import { useBrowserStatus } from '@/features/runtime/hooks/useBrowserStatus.js';
import styles from './MonitorMainShell.module.css';

const TASK_STATUS_LABEL: Record<ServiceStatus, string> = {
  ready: '就绪',
  unhealthy: '异常',
  unknown: '空闲',
};

export function MonitorMainShell() {
  const { refreshNow } = useBrowserStatus();

  const playwrightStatus = useRuntimeStore((s) => s.playwrightStatus);
  const playwrightUrl = useRuntimeStore(selectPlaywrightUrl);
  const lastScreenshotDataUrl = useRuntimeStore((s) => s.lastScreenshotDataUrl);
  const incrementSnapshotVersion = useRuntimeStore((s) => s.incrementSnapshotVersion);
  const preferredTransport = useRuntimeStore(selectLiveviewTransport);
  const playwrightIsOpen = useRuntimeStore(selectPlaywrightIsOpen);
  const setLiveviewTransport = useRuntimeStore((s) => s.setLiveviewTransport);

  const incrementLiveviewRefreshKey = useRuntimeStore((s) => s.incrementLiveviewRefreshKey);

  // Reconnect MJPEG stream + refresh health when tab becomes visible after backgrounding
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshNow();
        incrementLiveviewRefreshKey();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [incrementLiveviewRefreshKey, refreshNow]);

  const [webrtcFailed, setWebrtcFailed] = useState(false);
  const handleRenderError = useCallback(() => setWebrtcFailed(true), []);
  const effectiveTransport =
    preferredTransport === 'webrtc' && webrtcFailed ? 'mjpeg' : preferredTransport;

  // Reset WebRTC failure when browser reopens — publisher restarts fresh
  const [prevPlaywrightIsOpen, setPrevPlaywrightIsOpen] = useState(playwrightIsOpen);
  if (prevPlaywrightIsOpen !== playwrightIsOpen) {
    setPrevPlaywrightIsOpen(playwrightIsOpen);
    if (playwrightIsOpen) setWebrtcFailed(false);
  }

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

  const handleTransportChange = useCallback(
    (mode: 'webrtc' | 'mjpeg') => {
      setLiveviewTransport(mode);
      if (mode === 'webrtc') setWebrtcFailed(false);
      void refreshNow();
    },
    [setLiveviewTransport, refreshNow]
  );

  const indicatorClass =
    playwrightStatus === 'ready' ? `${styles.taskIndicator} ${styles.ready}` : styles.taskIndicator;

  return (
    <div className={styles.shell} data-testid={testIds.monitorMain}>
      {/* Header */}
      <div className={styles.header} data-testid={testIds.monitorMainHeader}>
        <h2 className={styles.headerTitle}>📸 实时监控</h2>
      </div>

      {/* LiveViewCanvas slot */}
      <div className={styles.liveviewContainer} data-testid={testIds.monitorMainLiveview}>
        <div className={styles.liveviewHeaderBar}>
          <h3 className={styles.liveviewTitle}>实时画面</h3>
          <div className={styles.liveviewHeaderMeta}>
            <TransportToggle
              transport={effectiveTransport}
              onTransportChange={handleTransportChange}
              webrtcAvailable={!webrtcFailed}
            />
            <span className={styles.liveviewUrl}>{playwrightUrl || '-'}</span>
          </div>
        </div>
        <div className={styles.liveviewCanvasWrap}>
          {effectiveTransport === 'webrtc' ? (
            <LiveKitView className={styles.liveviewCanvas} onRenderError={handleRenderError} />
          ) : (
            <LiveViewCanvas className={styles.liveviewCanvas} />
          )}
        </div>
      </div>

      {/* Task Strip */}
      <div className={styles.taskStrip}>
        <span className={indicatorClass} />
        <span className={styles.taskStatusText}>{TASK_STATUS_LABEL[playwrightStatus]}</span>
      </div>

      {/* Quick Actions */}
      <div className={styles.quickActions}>
        <button
          type="button"
          className={`${styles.actionBtn}${!lastScreenshotDataUrl ? ` ${styles.disabled}` : ''}`}
          data-testid={testIds.monitorMainDownloadBtn}
          onClick={handleDownload}
          disabled={!lastScreenshotDataUrl}
        >
          📸 下载截图
        </button>
        <button
          type="button"
          className={styles.actionBtn}
          data-testid={testIds.monitorMainRefreshBtn}
          onClick={handleRefresh}
        >
          🔄 刷新
        </button>
      </div>
    </div>
  );
}
