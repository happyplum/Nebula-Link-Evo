import React from 'react';
import { cn } from '@/lib/utils.js';
import { Check, X, Loader2 } from 'lucide-react';

export type RunTimelineStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RunTimelineStep {
  id: string;
  label: string;
  status: RunTimelineStepStatus;
  /** Elapsed duration in milliseconds; shown when the step has started. */
  durationMs?: number;
  /** Optional supporting detail rendered under the label. */
  detail?: string;
  /** Epoch ms the step transitioned to running; used to compute durationMs. */
  startedAt?: number;
}

export interface RunTimelineProps {
  steps: RunTimelineStep[];
}

/**
 * Vertical timeline of execution steps. Each step renders a status icon
 * (pending=number, running=spinner, completed=check, failed=cross) and its
 * label, optional detail, and duration. Steps accumulate from SSE
 * execution.progress events in ExecutionPanel.
 */
export const RunTimeline: React.FC<RunTimelineProps> = ({ steps }) => {
  return (
    <div className="space-y-2">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <div key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full',
                  step.status === 'completed' && 'bg-status-success text-white',
                  step.status === 'failed' && 'bg-status-error text-white',
                  step.status === 'running' && 'bg-status-info text-white',
                  step.status === 'pending' && 'border border-border-default text-text-muted',
                )}
              >
                {step.status === 'completed' && <Check size={14} aria-hidden="true" />}
                {step.status === 'failed' && <X size={14} aria-hidden="true" />}
                {step.status === 'running' && (
                  <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                )}
                {step.status === 'pending' && (
                  <span className="text-[10px] font-semibold">{index + 1}</span>
                )}
              </div>
              {!isLast && <div className="my-1 w-px flex-1 bg-border-default" aria-hidden="true" />}
            </div>
            <div className="flex-1 pb-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary">{step.label}</span>
                {step.durationMs !== undefined && step.durationMs > 0 && (
                  <span className="text-xs text-text-muted">{step.durationMs}ms</span>
                )}
              </div>
              {step.detail && (
                <div className="text-xs text-text-secondary">{step.detail}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
