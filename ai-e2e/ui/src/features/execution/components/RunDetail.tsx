import React from 'react';
import { Card } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import styles from './RunDetail.module.css';

interface RunDetailProps {
  run: ExecutionRun;
}

interface Step {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  duration_ms?: number;
}

export const RunDetail: React.FC<RunDetailProps> = ({ run }) => {
  let steps: Step[] = [];
  try {
    if (run.steps_json) {
      steps = JSON.parse(run.steps_json);
    }
  } catch {
    // Invalid JSON - steps remains empty array
  }

  return (
    <div className={styles.container}>
      <Card>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>{run.script_name}</h2>
            <div className={styles.meta}>
              <span>状态: {run.status}</span>
              <span>耗时: {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}</span>
              <span>开始时间: {new Date(run.started_at).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {run.error_message && (
          <div className={styles.errorBox}>
            <h3 className={styles.errorTitle}>执行错误</h3>
            <pre className={styles.errorMessage}>{run.error_message}</pre>
          </div>
        )}

        <div className={styles.steps}>
          {steps.map((step, index) => (
            <div key={index} className={`${styles.step} ${styles[step.status]}`}>
              <div className={styles.stepIndex}>{index + 1}</div>
              <div className={styles.stepName}>{step.name}</div>
              {step.duration_ms !== undefined && (
                <div className={styles.stepDuration}>{(step.duration_ms / 1000).toFixed(1)}s</div>
              )}
            </div>
          ))}
        </div>

        {run.screenshot_base64 && (
          <div className={styles.screenshot}>
            <img src={`data:image/jpeg;base64,${run.screenshot_base64}`} alt="执行截图" />
          </div>
        )}
      </Card>
    </div>
  );
};
