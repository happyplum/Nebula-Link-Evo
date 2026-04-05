import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import {
  useControlStore,
  selectBrowserOpen,
  selectBrowserUrl,
  selectIsExecutingAction,
} from '../store/control.store.js';
import {
  openBrowser,
  closeBrowser,
  navigateToUrl,
  takeScreenshot,
  fetchBrowserStatus,
} from '../api/control.adapters.js';
import { appendConsoleMessage } from '../lib/index.js';
import styles from './BrowserBasicShell.module.css';

export interface BrowserBasicShellProps {
  /** Whether the accordion is expanded. */
  open: boolean;
  /** Called when the accordion header is toggled. */
  onToggle: () => void;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
}

/** Normalize a bare host/path input into a full URL. */
function ensureUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

/**
 * Browser Basic accordion with live controls.
 * Manages browser open/close, navigation, screenshot, and stream reconnect.
 */
export function BrowserBasicShell({ open, onToggle, icon }: BrowserBasicShellProps) {
  const browserOpen = useControlStore(selectBrowserOpen);
  const browserUrl = useControlStore(selectBrowserUrl);
  const isExecuting = useControlStore(selectIsExecutingAction);
  const setExecutingAction = useControlStore((s) => s.setExecutingAction);
  const setActionError = useControlStore((s) => s.setActionError);
  const setBrowserOpen = useControlStore((s) => s.setBrowserOpen);
  const setBrowserUrl = useControlStore((s) => s.setBrowserUrl);

  const [urlInput, setUrlInput] = useState('');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        appendConsoleMessage('info', 'Playwright 控制已初始化');
        const status = await fetchBrowserStatus();
        if (cancelled) return;
        if (status.success && status.isOpen) {
          appendConsoleMessage('success', `浏览器已连接: ${status.url ?? ''}`);
        }
      } catch (err) {
        if (!cancelled) {
          appendConsoleMessage(
            'error',
            `初始化失败: ${err instanceof Error ? err.message : '未知错误'}`
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleOpen = useCallback(async () => {
    setExecutingAction(true);
    setActionError(null);
    try {
      appendConsoleMessage('info', '正在打开浏览器...');
      const res = await openBrowser();
      if (res.success) {
        appendConsoleMessage('success', '浏览器已打开');
        setBrowserOpen(true);
        const status = await fetchBrowserStatus();
        if (status.success) {
          setBrowserOpen(status.isOpen ?? true);
          setBrowserUrl(status.url ?? '');
        }
      } else {
        appendConsoleMessage('error', res.error ?? '打开失败');
        setActionError(res.error ?? '打开失败');
      }
    } catch (err) {
      appendConsoleMessage('error', err instanceof Error ? err.message : '打开失败');
      setActionError(err instanceof Error ? err.message : '打开失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError, setBrowserOpen, setBrowserUrl]);

  const handleClose = useCallback(async () => {
    setExecutingAction(true);
    setActionError(null);
    try {
      appendConsoleMessage('info', '正在关闭浏览器...');
      const res = await closeBrowser();
      if (res.success) {
        appendConsoleMessage('success', '浏览器已关闭');
        setBrowserOpen(false);
        setBrowserUrl('');
      } else {
        appendConsoleMessage('error', res.error ?? '关闭失败');
        setActionError(res.error ?? '关闭失败');
      }
    } catch (err) {
      appendConsoleMessage('error', err instanceof Error ? err.message : '关闭失败');
      setActionError(err instanceof Error ? err.message : '关闭失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError, setBrowserOpen, setBrowserUrl]);

  const handleNavigate = useCallback(async () => {
    const fullUrl = ensureUrl(urlInput);
    if (!fullUrl) return;
    setExecutingAction(true);
    setActionError(null);
    try {
      appendConsoleMessage('info', `正在导航到: ${fullUrl}...`);
      const res = await navigateToUrl(fullUrl);
      if (res.success) {
        appendConsoleMessage('success', '导航成功');
        setBrowserUrl(fullUrl);
        setUrlInput('');
      } else {
        appendConsoleMessage('error', res.error ?? '导航失败');
        setActionError(res.error ?? '导航失败');
      }
    } catch (err) {
      appendConsoleMessage('error', err instanceof Error ? err.message : '导航失败');
      setActionError(err instanceof Error ? err.message : '导航失败');
    } finally {
      setExecutingAction(false);
    }
  }, [urlInput, setExecutingAction, setActionError, setBrowserUrl]);

  const handleScreenshot = useCallback(async () => {
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await takeScreenshot();
      if (!res.success) {
        setActionError(res.error ?? '截图失败');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '截图失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError]);

  const handleReconnect = useCallback(async () => {
    setExecutingAction(true);
    setActionError(null);
    try {
      const res = await fetchBrowserStatus();
      if (res.success) {
        setBrowserOpen(res.isOpen ?? false);
        setBrowserUrl(res.url ?? '');
      } else {
        setActionError(res.error ?? '重连失败');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '重连失败');
    } finally {
      setExecutingAction(false);
    }
  }, [setExecutingAction, setActionError, setBrowserOpen, setBrowserUrl]);

  const handleUrlKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !isExecuting && browserOpen) {
        void handleNavigate();
      }
    },
    [handleNavigate, isExecuting, browserOpen]
  );

  return (
    <Accordion
      open={open}
      onToggle={onToggle}
      title="浏览器基础"
      icon={icon}
      testId={testIds.controlBrowserBasicStatus}
    >
      <div className={styles.body}>
        {/* Status area */}
        <div className={styles.statusRow}>
          <div
            className={`${styles.statusIndicator} ${browserOpen ? styles.connected : styles.disconnected}`}
            data-testid={testIds.controlBrowserBasicStatusIndicator}
          />
          <span className={styles.statusText} data-testid={testIds.controlBrowserBasicStatusText}>
            {browserOpen ? '已连接' : '未连接'}
          </span>
          <span className={styles.currentUrl} data-testid={testIds.controlBrowserBasicCurrentUrl}>
            {browserUrl || '-'}
          </span>
        </div>

        {/* Open / Close */}
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            disabled={isExecuting || browserOpen}
            onClick={handleOpen}
            data-testid={testIds.controlBrowserBasicOpenBtn}
          >
            打开
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={isExecuting || !browserOpen}
            onClick={handleClose}
            data-testid={testIds.controlBrowserBasicCloseBtn}
          >
            关闭
          </button>
        </div>

        {/* URL input */}
        <input
          type="text"
          className={styles.urlInput}
          placeholder="https://example.com"
          disabled={isExecuting || !browserOpen}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={handleUrlKeyDown}
          data-testid={testIds.controlBrowserBasicUrlInput}
        />

        {/* Navigate / Screenshot */}
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            disabled={isExecuting || !browserOpen || !urlInput.trim()}
            onClick={handleNavigate}
            data-testid={testIds.controlBrowserBasicNavigateBtn}
          >
            导航
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled={isExecuting || !browserOpen}
            onClick={handleScreenshot}
            data-testid={testIds.controlBrowserBasicScreenshotBtn}
          >
            截图
          </button>
        </div>

        {/* Reconnect stream */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnFull}`}
          disabled={isExecuting}
          onClick={handleReconnect}
          data-testid={testIds.controlBrowserBasicReconnectBtn}
        >
          重新连接视频流
        </button>
      </div>
    </Accordion>
  );
}
