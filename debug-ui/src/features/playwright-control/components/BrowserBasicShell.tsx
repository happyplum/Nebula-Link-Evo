import type { ReactNode } from 'react';
import { Accordion } from '@/shared/ui/Accordion.js';
import { testIds } from '@/shared/testing/testids.js';
import styles from './BrowserBasicShell.module.css';

export interface BrowserBasicShellProps {
  /** Whether the accordion is expanded. */
  open: boolean;
  /** Called when the accordion header is toggled. */
  onToggle: () => void;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
}

/**
 * Shell component for the "Browser Basic" accordion section.
 * Layout and labels only — no runtime state or event handlers.
 */
export function BrowserBasicShell({ open, onToggle, icon }: BrowserBasicShellProps) {
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
            className={styles.statusIndicator}
            data-testid={testIds.controlBrowserBasicStatusIndicator}
          />
          <span
            className={styles.statusText}
            data-testid={testIds.controlBrowserBasicStatusText}
          >
            未连接
          </span>
          <span
            className={styles.currentUrl}
            data-testid={testIds.controlBrowserBasicCurrentUrl}
          >
            -
          </span>
        </div>

        {/* Open / Close */}
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            disabled
            data-testid={testIds.controlBrowserBasicOpenBtn}
          >
            打开
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled
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
          disabled
          data-testid={testIds.controlBrowserBasicUrlInput}
        />

        {/* Navigate / Screenshot */}
        <div className={styles.btnRow}>
          <button
            type="button"
            className={styles.btn}
            disabled
            data-testid={testIds.controlBrowserBasicNavigateBtn}
          >
            导航
          </button>
          <button
            type="button"
            className={styles.btn}
            disabled
            data-testid={testIds.controlBrowserBasicScreenshotBtn}
          >
            截图
          </button>
        </div>

        {/* Reconnect stream */}
        <button
          type="button"
          className={`${styles.btn} ${styles.btnFull}`}
          disabled
          data-testid={testIds.controlBrowserBasicReconnectBtn}
        >
          重新连接视频流
        </button>
      </div>
    </Accordion>
  );
}
