import { useState } from 'react';
import { Modal } from '@/shared/ui/Modal.js';
import { testIds } from '@/shared/testing/testids.js';
import { formatDateTime, formatDuration } from '@/shared/lib/date.js';
import type { Interaction } from '../types/index.js';
import { FailureSampleModal } from './FailureSampleModal.js';
import styles from './InteractionDetailModal.module.css';

export interface InteractionDetailModalProps {
  interaction: Interaction | null;
  onClose: () => void;
}

export function InteractionDetailModal({ interaction, onClose }: InteractionDetailModalProps) {
  const [failureSamplePath, setFailureSamplePath] = useState<string | null>(null);

  if (!interaction) return null;

  return (
    <>
      <Modal open={!!interaction} onClose={onClose} title="交互详情">
        <div className={styles.container} data-testid="interaction-detail-modal">
          <div className={styles.grid}>
            <div className={styles.field}>
              <span className={styles.label}>ID</span>
              <span className={styles.value}>{interaction.id}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>时间</span>
              <span className={styles.value}>{formatDateTime(interaction.timestamp)}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>操作类型</span>
              <span className={styles.value}>{interaction.action_type}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>目标类型</span>
              <span className={styles.value}>{interaction.target_type}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>定位策略</span>
              <span className={styles.value}>{interaction.locator_strategy || '-'}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>状态</span>
              <span className={`${styles.value} ${interaction.success ? styles.success : styles.error}`}>
                {interaction.success ? '成功' : '失败'}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>耗时</span>
              <span className={styles.value}>
                {interaction.latency_ms != null ? formatDuration(interaction.latency_ms) : '-'}
              </span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>尝试次数</span>
              <span className={styles.value}>{interaction.attempts ?? '-'}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>快照 ID</span>
              <span className={styles.value}>{interaction.snapshot_id || '-'}</span>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>Nebula ID</span>
              <span className={styles.value}>{interaction.nebula_id || '-'}</span>
            </div>
          </div>

          {!interaction.success && (interaction.error_code || interaction.error_message) && (
            <div className={styles.errorBlock}>
              <h4 className={styles.errorTitle}>错误详情</h4>
              {interaction.error_code && (
                <div className={styles.errorCode}>错误码: {interaction.error_code}</div>
              )}
              {interaction.error_message && (
                <div className={styles.errorMessage}>{interaction.error_message}</div>
              )}
              {interaction.failure_sample_path && (
                <button
                  type="button"
                  className={styles.viewSampleBtn}
                  data-testid={testIds.failureSampleViewBtn}
                  onClick={() => setFailureSamplePath(interaction.failure_sample_path)}
                >
                  查看样本
                </button>
              )}
            </div>
          )}
        </div>
      </Modal>
      <FailureSampleModal
        open={!!failureSamplePath}
        onClose={() => setFailureSamplePath(null)}
        samplePath={failureSamplePath}
      />
    </>
  );
}
