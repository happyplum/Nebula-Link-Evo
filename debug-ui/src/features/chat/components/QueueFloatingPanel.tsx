import React from 'react';
import type { PendingJobInfo } from '@nebula-link-evo/shared';
import styles from './QueueFloatingPanel.module.css';

export interface QueueFloatingPanelProps {
  pendingJobs: PendingJobInfo[];
  onCancel: (jobId: string) => void;
}

export const QueueFloatingPanel: React.FC<QueueFloatingPanelProps> = React.memo(
  ({ pendingJobs, onCancel }) => {
    if (!pendingJobs || pendingJobs.length === 0) {
      return null;
    }

    return (
      <div className={styles.panel} data-testid="queue-floating-panel">
        {pendingJobs.map((job) => {
          // Truncate content preview to ~50 chars
          const preview =
            job.contentPreview.length > 50
              ? `${job.contentPreview.substring(0, 50)}...`
              : job.contentPreview;

          return (
            <div
              key={job.jobId}
              className={styles.jobItem}
              data-testid="queue-job-item"
            >
              <div className={styles.jobInfo}>
                <div
                  className={styles.statusDot}
                  data-status={job.status}
                  data-testid={`status-dot-${job.jobId}`}
                  aria-label={`Status: ${job.status}`}
                />
                <div className={styles.contentPreview} title={job.contentPreview}>
                  {preview}
                </div>
              </div>
              {job.status === 'queued' && (
                <button
                  className={styles.cancelButton}
                  onClick={() => onCancel(job.jobId)}
                  data-job-id={job.jobId}
                  aria-label="Cancel job"
                >
                  Cancel
                </button>
              )}
            </div>
          );
        })}
      </div>
    );
  },
  (prevProps, nextProps) => {
    // Custom comparison to avoid unnecessary re-renders
    if (prevProps.pendingJobs.length !== nextProps.pendingJobs.length) {
      return false;
    }
    
    for (let i = 0; i < prevProps.pendingJobs.length; i++) {
      const prev = prevProps.pendingJobs[i];
      const next = nextProps.pendingJobs[i];
      if (
        prev.jobId !== next.jobId ||
        prev.status !== next.status ||
        prev.contentPreview !== next.contentPreview
      ) {
        return false;
      }
    }
    
    return true;
  }
);
