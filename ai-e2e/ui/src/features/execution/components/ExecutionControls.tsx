import React from 'react';
import { Button, Card } from '@/shared/components';
import { useRunAllScripts } from '../store/executionApi';
import styles from './ExecutionControls.module.css';

interface ExecutionControlsProps {
  projectId: string;
  isRunning: boolean;
  currentScript?: string;
  currentStep?: string;
  progress?: number;
}

export const ExecutionControls: React.FC<ExecutionControlsProps> = ({
  projectId,
  isRunning,
  currentScript,
  currentStep,
  progress = 0,
}) => {
  const { mutate: runAll, isPending } = useRunAllScripts(projectId);

  const handleRunAll = () => {
    runAll();
  };

  return (
    <Card title="执行控制">
      <div className={styles.container}>
        <div className={styles.actions}>
          <Button 
            onClick={handleRunAll} 
            disabled={isRunning || isPending}
            isLoading={isPending}
          >
            执行全部脚本
          </Button>
          <div className={styles.status}>
            <div className={`${styles.statusIndicator} ${isRunning ? styles.running : styles.idle}`} />
            {isRunning ? '执行中...' : '就绪'}
          </div>
        </div>

        {isRunning && (
          <div className={styles.progressContainer}>
            <div className={styles.currentTask}>
              {currentScript && <div>脚本: {currentScript}</div>}
              {currentStep && <div>步骤: {currentStep}</div>}
            </div>
            <div className={styles.progressBar}>
              <div 
                className={styles.progressFill} 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className={styles.progressText}>{progress}%</div>
          </div>
        )}
      </div>
    </Card>
  );
};
