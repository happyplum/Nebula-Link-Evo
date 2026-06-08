import React from 'react';
import { Button, Card } from '@/shared/components';
import { useRunAllScripts } from '../store/executionApi';
import { cn } from '@/lib/utils';

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
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button 
            onClick={handleRunAll} 
            disabled={isRunning || isPending}
            isLoading={isPending}
          >
            执行全部脚本
          </Button>
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <div className={cn("w-2 h-2 rounded-full", isRunning ? "bg-status-info animate-pulse" : "bg-text-muted")} />
            {isRunning ? '执行中...' : '就绪'}
          </div>
        </div>

        {isRunning && (
          <div className="space-y-2 mt-4">
            <div className="space-y-1 text-sm text-text-secondary">
              {currentScript && <div>脚本: {currentScript}</div>}
              {currentStep && <div>步骤: {currentStep}</div>}
            </div>
            <div className="w-full h-1.5 bg-surface-elevated rounded-full overflow-hidden">
              <div 
                className="h-full bg-status-info rounded-full transition-all" 
                style={{ width: `${progress}%` }} 
              />
            </div>
            <div className="text-xs text-text-muted text-right">{progress}%</div>
          </div>
        )}
      </div>
    </Card>
  );
};
