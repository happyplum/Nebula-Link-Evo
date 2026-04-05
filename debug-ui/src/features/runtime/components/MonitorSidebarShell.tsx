import { useCallback, useEffect, useState } from 'react';
import { testIds } from '@/shared/testing/testids.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import { useRuntimeStore } from '@/features/runtime/store/runtime.store.js';
import type { ConnectionStatus, ServiceStatus } from '@/features/runtime/store/runtime.store.js';
import { useDebugSocket } from '@/features/runtime/hooks/useDebugSocket.js';
import {
  takeScreenshot,
  fetchDomSnapshot,
} from '@/features/playwright-control/api/control.adapters.js';
import { useControlStore } from '@/features/playwright-control/store/control.store.js';
import { normalizeDomElements } from '@/features/playwright-control/lib/index.js';
import { appendConsoleMessage } from '@/features/playwright-control/lib/index.js';
import { ImagePreviewModal } from '@/shared/ui/ImagePreviewModal.js';
import styles from './MonitorSidebarShell.module.css';

async function decodeAnnotatedScreenshot(base64: string): Promise<string> {
  const response = await fetch(`data:application/octet-stream;base64,${base64}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (!isGzip) {
    return `data:image/jpeg;base64,${base64}`;
  }

  const decompressed = await new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  ).arrayBuffer();
  return URL.createObjectURL(new Blob([decompressed], { type: 'image/jpeg' }));
}

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
  const setLastScreenshotDataUrl = useRuntimeStore((s) => s.setLastScreenshotDataUrl);
  const setExecutingAction = useControlStore((s) => s.setExecutingAction);
  const setActionError = useControlStore((s) => s.setActionError);
  const actionError = useControlStore((s) => s.lastActionError);
  const setDomElements = useControlStore((s) => s.setDomElements);
  const setSnapshotId = useControlStore((s) => s.setSnapshotId);
  const [domScreenshotUrl, setDomScreenshotUrl] = useState<string | null>(null);
  const [domSnapshotId, setDomSnapshotId] = useState<string>('—');
  const [domApiVersion, setDomApiVersion] = useState<string>('—');
  const [previewOpen, setPreviewOpen] = useState(false);

  const { sendMessage, reconnect } = useDebugSocket();

  useEffect(() => {
    return () => {
      if (domScreenshotUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(domScreenshotUrl);
      }
    };
  }, [domScreenshotUrl]);

  const handleWsRefresh = useCallback(() => {
    reconnect();
  }, [reconnect]);

  const handleStep = useCallback(() => {
    sendMessage('step');
    incrementSnapshotVersion();
  }, [sendMessage, incrementSnapshotVersion]);

  const handlePause = useCallback(() => {
    sendMessage('pause');
  }, [sendMessage]);

  const handleResume = useCallback(() => {
    sendMessage('resume');
  }, [sendMessage]);

  const handleBrowserScreenshot = useCallback(async () => {
    appendConsoleMessage('info', '正在获取截图...');
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await takeScreenshot();
      if (res.success && res.screenshot) {
        const dataUrl = res.screenshot.startsWith('data:')
          ? res.screenshot
          : `data:image/png;base64,${res.screenshot}`;
        setLastScreenshotDataUrl(dataUrl);
        incrementSnapshotVersion();
        appendConsoleMessage('success', '截图已更新');
      } else {
        appendConsoleMessage('error', res.error ?? '截图失败');
        setActionError(res.error ?? '截图失败');
      }
    } catch (err) {
      appendConsoleMessage('error', err instanceof Error ? err.message : '截图失败');
      setActionError(err instanceof Error ? err.message : '截图失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError, setLastScreenshotDataUrl, incrementSnapshotVersion]);

  const handleRefreshDom = useCallback(async () => {
    appendConsoleMessage('info', '正在获取 DOM...');
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await fetchDomSnapshot();
      if (res.success && res.dom) {
        if (res.dom.elements_map) {
          setDomElements(normalizeDomElements(res.dom.elements_map));
        }
        if (res.dom.snapshot_id) {
          setSnapshotId(res.dom.snapshot_id);
          setDomSnapshotId(res.dom.snapshot_id);
        }
        setDomApiVersion(res.dom.version ?? '—');
        if (res.dom.annotated_screenshot_base64) {
          try {
            const nextUrl = await decodeAnnotatedScreenshot(res.dom.annotated_screenshot_base64);
            setDomScreenshotUrl((prev) => {
              if (prev?.startsWith('blob:')) {
                URL.revokeObjectURL(prev);
              }
              return nextUrl;
            });
          } catch (decodeErr) {
            console.error('[MonitorSidebar] Screenshot decode failed:', decodeErr);
            setDomScreenshotUrl(null);
            setActionError(
              `截图解码失败: ${decodeErr instanceof Error ? decodeErr.message : '未知错误'}`
            );
          }
        } else {
          setDomScreenshotUrl(null);
          setActionError('DOM 截图数据为空，请确认浏览器已打开页面');
        }
        incrementSnapshotVersion();
        appendConsoleMessage('success', '已加载带标记的截图');
      } else {
        appendConsoleMessage('error', res.error ?? 'DOM 刷新失败');
        setActionError(res.error ?? 'DOM 刷新失败');
      }
    } catch (err) {
      appendConsoleMessage('error', err instanceof Error ? err.message : 'DOM 刷新失败');
      setActionError(err instanceof Error ? err.message : 'DOM 刷新失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError, setDomElements, setSnapshotId, incrementSnapshotVersion]);

  return (
    <div className={styles.shell} data-testid={testIds.monitorSidebar}>
      {/* Card 1: WebSocket Status */}
      <div className={styles.card} data-testid={testIds.monitorSidebarWsCard}>
        <h3 className={styles.cardTitle}>WebSocket 状态</h3>
        <div className={styles.statusRow}>
          <StatusIndicator status={CONNECTION_STATUS_MAP[connectionStatus]} size="sm" />
          <span className={styles.statusText} data-testid={testIds.monitorSidebarWsStatusText}>
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
          <StatusIndicator status={PLAYWRIGHT_STATUS_MAP[playwrightStatus]} size="sm" />
          <span className={styles.statusText} data-testid={testIds.monitorSidebarBrowserStatusText}>
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
        <h3 className={styles.cardTitle}>DOM 截图 (Annotated)</h3>
        <div className={styles.snapshotMeta}>
          <p className={styles.statusText} data-testid={testIds.monitorSidebarSnapshotLabel}>
            ID: {domSnapshotId}
          </p>
          <p className={styles.statusText}>
            Ver: {domApiVersion === '—' ? snapshotVersion || '—' : domApiVersion}
          </p>
        </div>
        {actionError && (
          <p className={styles.statusError} data-testid={testIds.monitorSidebarSnapshotError}>
            {actionError}
          </p>
        )}
        {domScreenshotUrl ? (
          <button
            type="button"
            className={styles.snapshotClickable}
            onClick={() => setPreviewOpen(true)}
            data-testid={testIds.monitorSidebarSnapshotImg}
          >
            <img
              src={domScreenshotUrl}
              alt="Annotated Screenshot"
              className={styles.snapshotImage}
            />
          </button>
        ) : (
          <div
            className={styles.screenshotPlaceholder}
            data-testid={testIds.monitorSidebarSnapshotImg}
          >
            暂无截图
          </div>
        )}
        <button
          type="button"
          className={styles.btnFull}
          data-testid={testIds.monitorSidebarSnapshotRefreshBtn}
          onClick={handleRefreshDom}
        >
          刷新 DOM 截图
        </button>
      </div>
      {domScreenshotUrl && (
        <ImagePreviewModal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          src={domScreenshotUrl}
          alt="Annotated Screenshot"
          title="DOM 截图 (Annotated)"
        />
      )}
    </div>
  );
}
