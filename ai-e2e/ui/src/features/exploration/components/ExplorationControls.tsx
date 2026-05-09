import React from 'react';
import { Button } from '@/shared/components';
import styles from './ExplorationControls.module.css';

interface ExplorationControlsProps {
  isExploring: boolean;
  progress: number;
  message: string | null;
  pagesVisited: number;
  urlsFound: number;
  onStart: () => void;
  onStop: () => void;
}

export const ExplorationControls: React.FC<ExplorationControlsProps> = ({
  isExploring,
  progress,
  message,
  pagesVisited,
  urlsFound,
  onStart,
  onStop,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>Web 探索</div>
        <div className={styles.actions}>
          {!isExploring ? (
            <Button variant="primary" onClick={onStart}>
              开始探索
            </Button>
          ) : (
            <Button variant="danger" onClick={onStop}>
              停止探索
            </Button>
          )}
        </div>
      </div>

      {isExploring && (
        <div className={styles.progressContainer}>
          <div className={styles.progressHeader}>
            <span>{message || '探索中...'}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill} 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>
      )}

      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span>已访问页面:</span>
          <span className={styles.statValue}>{pagesVisited}</span>
        </div>
        <div className={styles.statItem}>
          <span>发现 URL:</span>
          <span className={styles.statValue}>{urlsFound}</span>
        </div>
      </div>
    </div>
  );
};
