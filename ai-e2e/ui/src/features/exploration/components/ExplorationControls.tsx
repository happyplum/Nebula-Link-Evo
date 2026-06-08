import React from 'react';
import { Button } from '@/shared/components';

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
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Web 探索</div>
        <div className="flex gap-2">
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
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span>{message || '探索中...'}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full h-1.5 bg-surface-elevated rounded-full overflow-hidden">
            <div 
              className="h-full bg-status-info rounded-full" 
              style={{ width: `${progress}%` }} 
            />
          </div>
        </div>
      )}

      <div className="flex gap-4 text-xs text-text-muted">
        <div>
          <span>已访问页面:</span>
          <span className="font-medium text-text-primary">{pagesVisited}</span>
        </div>
        <div>
          <span>发现 URL:</span>
          <span className="font-medium text-text-primary">{urlsFound}</span>
        </div>
      </div>
    </div>
  );
};
