import { Modal } from '@/shared/ui/Modal.js';
import { formatDateTime, formatDuration } from '@/shared/lib/date.js';
import { useTaskDetail } from '../api/history.queries.js';
import { StatusIndicator } from '@/shared/ui/StatusIndicator.js';
import styles from './TaskDetailModal.module.css';

export interface TaskDetailModalProps {
  taskId: string | null;
  onClose: () => void;
}

export function TaskDetailModal({ taskId, onClose }: TaskDetailModalProps) {
  const { data: task, isLoading, error } = useTaskDetail(taskId || '');

  if (!taskId) return null;

  return (
    <Modal open={!!taskId} onClose={onClose} title="Task Details">
      <div className={styles.container} data-testid="task-detail-modal">
        {isLoading && (
          <div className={styles.loading}>
            <StatusIndicator status="loading" label="Loading task details..." />
          </div>
        )}

        {error && (
          <div className={styles.error}>
            <StatusIndicator status="error" label="Failed to load task details" />
          </div>
        )}

        {task && (
          <>
            <div className={styles.header}>
              <div className={styles.field}>
                <span className={styles.label}>Task ID</span>
                <span className={styles.value}>{task.taskId}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Status</span>
                <span className={`${styles.value} ${styles[task.status] || ''}`}>
                  {task.status}
                </span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Start Time</span>
                <span className={styles.value}>{formatDateTime(task.startTime)}</span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>End Time</span>
                <span className={styles.value}>
                  {task.endTime ? formatDateTime(task.endTime) : '-'}
                </span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>Duration</span>
                <span className={styles.value}>
                  {task.endTime
                    ? formatDuration(new Date(task.endTime).getTime() - new Date(task.startTime).getTime())
                    : '-'}
                </span>
              </div>
              <div className={styles.field}>
                <span className={styles.label}>URL</span>
                <span className={styles.value}>{task.url}</span>
              </div>
            </div>

            <div className={styles.instructionBlock}>
              <span className={styles.label}>Instruction</span>
              <p className={styles.instruction}>{task.instruction}</p>
            </div>

            {task.error && (
              <div className={styles.errorBlock}>
                <span className={styles.label}>Error</span>
                <p className={styles.errorMessage}>{task.error}</p>
              </div>
            )}

            {task.result && (
              <div className={styles.resultBlock}>
                <span className={styles.label}>Result</span>
                <p className={styles.resultMessage}>{task.result}</p>
              </div>
            )}

            <div className={styles.stepsSection}>
              <h3 className={styles.stepsTitle}>Steps ({task.steps?.length || 0})</h3>
              <div className={styles.stepsList}>
                {task.steps?.map((step) => (
                  <div key={step.step} className={styles.stepItem}>
                    <div className={styles.stepHeader}>
                      <span className={styles.stepNumber}>Step {step.step}</span>
                      <span className={styles.stepTime}>{formatDateTime(step.timestamp)}</span>
                      <span className={`${styles.stepStatus} ${step.success ? styles.success : styles.error}`}>
                        {step.success ? 'Success' : 'Failed'}
                      </span>
                    </div>
                    <div className={styles.stepAction}>
                      <span className={styles.actionType}>{step.action.type}</span>
                    </div>
                    <div className={styles.stepMessage}>{step.message}</div>
                  </div>
                ))}
                {(!task.steps || task.steps.length === 0) && (
                  <div className={styles.noSteps}>No steps recorded</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
