import React from 'react';
import { Badge } from '@/components/ui/badge.js';
import type { ExecutionRun } from '../store/executionApi.js';

interface RecentRunsProps {
  runs: ExecutionRun[];
  isLoading?: boolean;
}

function statusVariant(status: ExecutionRun['status']): 'default' | 'destructive' | 'secondary' {
  if (status === 'pass' || status === 'passed' || status === 'fix_applied') return 'default';
  if (
    status === 'fail' ||
    status === 'failed' ||
    status === 'error' ||
    status === 'timeout' ||
    status === 'fix_rejected'
  )
    return 'destructive';
  return 'secondary';
}

export const RecentRuns: React.FC<RecentRunsProps> = ({ runs, isLoading }) => {
  if (isLoading) {
    return (
      <div className="rounded-lg border border-border-default bg-surface-panel p-6">
        <div className="space-y-3">
          <div className="h-4 w-1/2 animate-pulse rounded bg-surface-elevated" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-surface-elevated" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-elevated" />
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-border-default bg-surface-panel p-6 text-center">
        <div className="text-sm text-text-muted">暂无执行记录</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-default bg-surface-panel">
      <div className="border-b border-border-default px-4 py-3 text-sm font-medium text-text-primary">
        最近执行
      </div>
      <ul className="divide-y divide-border-default">
        {runs.slice(0, 5).map((run) => (
          <li key={run.id} className="flex items-center justify-between px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-text-primary">{run.script_name}</div>
              <div className="text-xs text-text-muted">
                {run.started_at ? new Date(run.started_at).toLocaleString() : '—'}
              </div>
            </div>
            <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
};
