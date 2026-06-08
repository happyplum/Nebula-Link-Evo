import React from 'react';
import { Card } from '@/shared/components';
import { ExecutionRun } from '../store/executionApi';
import { cn } from '@/lib/utils';

interface RunDetailProps {
  run: ExecutionRun;
}

interface Step {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  duration_ms?: number;
}

const stepStatusMap: Record<string, string> = {
  passed: 'border-l-2 border-status-success',
  running: 'border-l-2 border-status-info',
  failed: 'border-l-2 border-status-error',
  pending: 'border-l-2 border-text-muted',
};

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
    <div>
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-base font-medium">{run.script_name}</h2>
            <div className="flex gap-3 text-xs text-text-muted mt-1">
              <span>状态: {run.status}</span>
              <span>耗时: {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '-'}</span>
              <span>开始时间: {new Date(run.started_at).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {run.error_message && (
          <div className="bg-red-950/30 border border-red-800/50 rounded-md p-3 mt-4">
            <h3 className="text-sm font-medium text-status-error">执行错误</h3>
            <pre className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">{run.error_message}</pre>
          </div>
        )}

        <div className="space-y-2 mt-4">
          {steps.map((step, index) => (
            <div key={index} className={cn("flex items-center gap-3 px-3 py-2 rounded-md bg-surface-content", stepStatusMap[step.status])}>
              <div className="w-6 h-6 rounded-full bg-surface-elevated flex items-center justify-center text-xs">{index + 1}</div>
              <div className="flex-1 text-sm">{step.name}</div>
              {step.duration_ms !== undefined && (
                <div className="text-xs text-text-muted">{(step.duration_ms / 1000).toFixed(1)}s</div>
              )}
            </div>
          ))}
        </div>

        {run.screenshot_base64 && (
          <div className="mt-4 border border-border-default rounded-md overflow-hidden">
            <img className="w-full" src={`data:image/jpeg;base64,${run.screenshot_base64}`} alt="执行截图" />
          </div>
        )}
      </Card>
    </div>
  );
};
