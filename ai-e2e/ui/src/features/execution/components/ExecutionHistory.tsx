import React from 'react';
import { Card } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import { cn } from '@/lib/utils';

const timelineDotStatusMap: Record<string, string> = {
  running: 'bg-status-info animate-pulse',
  completed: 'bg-status-success',
  passed: 'bg-status-success',
  pass: 'bg-status-success',
  failed: 'bg-status-error',
  fail: 'bg-status-error',
  error: 'bg-status-error',
  pending: 'bg-text-muted',
};

interface ExecutionHistoryProps {
  runs: ExecutionRun[];
}

export const ExecutionHistory: React.FC<ExecutionHistoryProps> = ({ runs }) => {
  // Sort runs by started_at descending
  const sortedRuns = [...runs].sort((a, b) => 
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );

  return (
    <Card title="执行历史">
      <div>
        {sortedRuns.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-muted text-sm">
            暂无执行历史
          </div>
        ) : (
          <div className="space-y-4">
            {sortedRuns.map((run) => (
              <div key={run.id} className="flex gap-3">
                <div className={cn("w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0", timelineDotStatusMap[run.status] || 'bg-text-muted')} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">{run.script_name}</div>
                    <div className="text-xs text-text-muted">
                      {new Date(run.started_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary mt-1">
                    状态: {run.status}
                    {run.duration_ms && ` · 耗时: ${(run.duration_ms / 1000).toFixed(1)}s`}
                    {run.ai_fix_applied && ' · AI 修复已采纳'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
