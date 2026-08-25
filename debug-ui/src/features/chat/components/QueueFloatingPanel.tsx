import React, { useCallback } from 'react';
import { useChatStore } from '../store/chat.store.js';
import { apiChatSessionJob } from '../../../shared/api/endpoints.js';
import styles from './QueueFloatingPanel.module.css';

export interface QueueFloatingPanelProps {
  sessionId: string;
}

export const QueueFloatingPanel: React.FC<QueueFloatingPanelProps> = React.memo(
  ({ sessionId }) => {
    const pendingJobs = useChatStore((s) => s.pendingJobs[sessionId]);

    const handleCancel = useCallback(
      async (jobId: string) => {
        try {
          await fetch(apiChatSessionJob(sessionId, jobId), {
            method: 'DELETE',
          });
        } catch (error) {
          console.error('Failed to cancel job:', error);
        }
      },
      [sessionId]
    );

    if (!pendingJobs || pendingJobs.length === 0) {
      return null;
    }

    return (
      <div className={styles.panel} data-testid="queue-floating-panel">
        {pendingJobs.map((job) => {
          const preview =
            job.contentPreview.length > 50
              ? `${job.contentPreview.substring(0, 50)}...`
              : job.contentPreview;

          return (
            <div key={job.jobId} className={styles.jobItem} data-testid="queue-job-item">
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
                  onClick={() => handleCancel(job.jobId)}
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
    return prevProps.sessionId === nextProps.sessionId;
  }
);
