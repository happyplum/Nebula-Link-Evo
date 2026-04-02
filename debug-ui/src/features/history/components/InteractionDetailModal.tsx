import { Modal } from '@/shared/ui/Modal.js';
import { formatDateTime, formatDuration } from '@/shared/lib/date.js';
import type { Interaction } from '../types/index.js';
import styles from './InteractionDetailModal.module.css';

export interface InteractionDetailModalProps {
  interaction: Interaction | null;
  onClose: () => void;
}

export function InteractionDetailModal({ interaction, onClose }: InteractionDetailModalProps) {
  if (!interaction) return null;

  return (
    <Modal open={!!interaction} onClose={onClose} title="Interaction Details">
      <div className={styles.container} data-testid="interaction-detail-modal">
        <div className={styles.grid}>
          <div className={styles.field}>
            <span className={styles.label}>ID</span>
            <span className={styles.value}>{interaction.id}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Time</span>
            <span className={styles.value}>{formatDateTime(interaction.timestamp)}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Action Type</span>
            <span className={styles.value}>{interaction.action_type}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Target Type</span>
            <span className={styles.value}>{interaction.target_type}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Locator Strategy</span>
            <span className={styles.value}>{interaction.locator_strategy || '-'}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Status</span>
            <span className={`${styles.value} ${interaction.success ? styles.success : styles.error}`}>
              {interaction.success ? 'Success' : 'Failed'}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Latency</span>
            <span className={styles.value}>
              {interaction.latency_ms != null ? formatDuration(interaction.latency_ms) : '-'}
            </span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Attempts</span>
            <span className={styles.value}>{interaction.attempts ?? '-'}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Snapshot ID</span>
            <span className={styles.value}>{interaction.snapshot_id || '-'}</span>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>Nebula ID</span>
            <span className={styles.value}>{interaction.nebula_id || '-'}</span>
          </div>
        </div>

        {!interaction.success && (interaction.error_code || interaction.error_message) && (
          <div className={styles.errorBlock}>
            <h4 className={styles.errorTitle}>Error Details</h4>
            {interaction.error_code && (
              <div className={styles.errorCode}>Code: {interaction.error_code}</div>
            )}
            {interaction.error_message && (
              <div className={styles.errorMessage}>{interaction.error_message}</div>
            )}
            {interaction.failure_sample_path && (
              <div className={styles.errorPath}>Sample: {interaction.failure_sample_path}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
