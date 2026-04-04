import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal.js';
import { testIds } from '@/shared/testing/testids.js';
import { useFailureSample } from '../api/history.queries.js';
import styles from './FailureSampleModal.module.css';

export interface FailureSampleModalProps {
  open: boolean;
  onClose: () => void;
  samplePath: string | null;
}

export function FailureSampleModal({ open, onClose, samplePath }: FailureSampleModalProps) {
  const { data, isLoading, error } = useFailureSample(open ? samplePath : null);
  const [domExpanded, setDomExpanded] = useState(false);

  const sample = data?.success ? data.data : null;

  let parsedDom: string | null = null;
  if (sample?.dom) {
    try {
      parsedDom = JSON.stringify(JSON.parse(sample.dom), null, 2);
    } catch {
      parsedDom = sample.dom;
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="失败样本详情">
      <div className={styles.container} data-testid={testIds.failureSampleModal}>
        {isLoading && <div className={styles.loading}>加载中…</div>}
        {error && <div className={styles.loadError}>无法加载样本</div>}
        {!isLoading && !error && !sample && (
          <div className={styles.empty}>无样本数据</div>
        )}

        {sample && (
          <>
            {/* Screenshot */}
            {sample.screenshot && (
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>截图</h4>
                <div className={styles.screenshotWrap}>
                  <img
                    className={styles.screenshot}
                    src={`data:image/png;base64,${sample.screenshot}`}
                    alt="Failure screenshot"
                    data-testid={testIds.failureSampleScreenshot}
                  />
                </div>
              </div>
            )}

            {/* Error context */}
            <div className={styles.section} data-testid={testIds.failureSampleContext}>
              <h4 className={styles.sectionTitle}>错误上下文</h4>
              <div className={styles.contextGrid}>
                <span className={styles.contextLabel}>操作</span>
                <span className={styles.contextValue}>{sample.context.action}</span>
                <span className={styles.contextLabel}>时间</span>
                <span className={styles.contextValue}>{sample.context.timestamp}</span>
                <span className={styles.contextLabel}>URL</span>
                <span className={styles.contextValue}>{sample.context.url}</span>
              </div>
              <div className={styles.errorMsg}>{sample.context.error.message}</div>
              {sample.context.error.stack && (
                <pre className={styles.stackTrace}>{sample.context.error.stack}</pre>
              )}
            </div>

            {/* DOM snapshot */}
            {parsedDom && (
              <div className={styles.section}>
                <button
                  type="button"
                  className={styles.domToggle}
                  onClick={() => setDomExpanded((v) => !v)}
                  aria-expanded={domExpanded}
                >
                  <span
                    className={`${styles.domToggleArrow} ${domExpanded ? styles.domToggleArrowOpen : ''}`}
                  >
                    ▶
                  </span>
                  DOM 快照
                </button>
                {domExpanded && (
                  <pre className={styles.domContent} data-testid={testIds.failureSampleDom}>
                    {parsedDom}
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
