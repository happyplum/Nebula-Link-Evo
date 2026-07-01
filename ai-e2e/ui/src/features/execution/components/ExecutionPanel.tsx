import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useRuns, useRunDetail, useRunScript, executionKeys, ExecutionRun } from '../store/executionApi';
import { scriptsKeys } from '@/features/scripts/store/scriptsApi.js';
import { useSSE } from '@/hooks/use-sse.js';
import { useStore } from 'zustand';
import { createAIStatusStore } from '../../ai-status/store/aiStatusStore';
import { reportKeys } from '../../report/store/reportApi.js';
import { Card } from '@/shared/components';
import { ExecutionControls } from './ExecutionControls';
import { ResultDashboard } from './ResultDashboard';
import { RunDetail } from './RunDetail';
import { DiagnosisPanel } from './DiagnosisPanel';
import { ExecutionHistory } from './ExecutionHistory';
import { RunTimeline, type RunTimelineStep } from './RunTimeline.js';

export default function ExecutionPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  
  const { data: runs = [], isLoading: isRunsLoading } = useRuns(projectId || '');
  const { mutate: runScript } = useRunScript(projectId || '');
  
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);
  const [currentScript, setCurrentScript] = useState<string>();
  const [currentStep, setCurrentStep] = useState<string>();
  const [progress, setProgress] = useState(0);
  // Accumulated execution step timeline driven by execution.progress SSE events.
  const [timelineSteps, setTimelineSteps] = useState<RunTimelineStep[]>([]);

  // AI Status Store (vanilla store + useStore)
  const aiStatusStore = useRef(createAIStatusStore()).current;
  const setAIStatus = useStore(aiStatusStore, state => state.setStatus);
  const setAIMessage = useStore(aiStatusStore, state => state.setMessage);

  // SSE Connection
  useSSE({
    projectId: projectId || '',
    handlers: {
      'execution.started': (data) => {
        setIsRunning(true);
        setCurrentScript(data.scriptId);
        setCurrentStep('初始化...');
        setProgress(0);
        setAIStatus('running');
        setAIMessage(`开始执行脚本: ${data.scriptId}`);
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
        // Reset the timeline with a single "started" step.
        setTimelineSteps([
          {
            id: 'start',
            label: '开始执行',
            status: 'completed',
            detail: data.scriptId,
          },
        ]);
      },
      'execution.progress': (data) => {
        setCurrentStep(data.step);
        setAIMessage(`执行中: ${data.step}`);
        // Increment progress by a small amount since backend doesn't provide step index
        setProgress(prev => Math.min(prev + 5, 90));
        // Append a new step or advance the current running step.
        const stepName = data.step || '执行中...';
        const now = Date.now();
        setTimelineSteps((prev) => {
          const existing = prev.find((s) => s.label === stepName);
          if (existing) {
            return prev.map((s) =>
              s.label === stepName
                ? {
                    ...s,
                    status: 'running' as const,
                    durationMs: s.startedAt ? now - s.startedAt : s.durationMs,
                  }
                : s.status === 'running'
                  ? { ...s, status: 'completed' as const }
                  : s,
            );
          }
          return [
            ...prev.map((s) =>
              s.status === 'running' ? { ...s, status: 'completed' as const } : s,
            ),
            {
              id: `${stepName}-${now}`,
              label: stepName,
              status: 'running' as const,
              startedAt: now,
            },
          ];
        });
      },
      'execution.completed': (data) => {
        setIsRunning(false);
        setCurrentScript(undefined);
        setCurrentStep(undefined);
        setProgress(100);
        setAIStatus('completed');
        setAIMessage('执行完成');
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(projectId!) });
        // execution.completed has { run: ExecutionRun }, so access run.id
        if (selectedRunId === data.run?.id) {
          queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId!, data.run.id) });
        }
        // Finalize the timeline: mark every running step completed and append a done step.
        setTimelineSteps((prev) => [
          ...prev.map((s) =>
            s.status === 'running' ? { ...s, status: 'completed' as const } : s,
          ),
          { id: 'done', label: '执行完成', status: 'completed' as const },
        ]);
      },
      'execution.failed': (data) => {
        setIsRunning(false);
        setCurrentScript(undefined);
        setCurrentStep(undefined);
        setProgress(100);
        setAIStatus('error');
        setAIMessage(`执行失败: ${data.error}`);
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(projectId!) });
        if (selectedRunId === data.runId) {
          queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId!, data.runId) });
        }
        // Mark the last running step as failed and append a terminal failure step.
        setTimelineSteps((prev) => {
          const lastRunning = [...prev].reverse().find((s) => s.status === 'running');
          return [
            ...prev.map((s) =>
              s === lastRunning ? { ...s, status: 'failed' as const } : s,
            ),
            {
              id: 'failed',
              label: '执行失败',
              status: 'failed' as const,
              detail: data.error,
            },
          ];
        });
      },
      'ai.diagnosis': (data) => {
        queryClient.invalidateQueries({ queryKey: executionKeys.diagnosis(projectId!, data.runId) });
      },
      'ai.fix_applied': () => {
        queryClient.invalidateQueries({ queryKey: reportKeys.detail(projectId!) });
        queryClient.invalidateQueries({ queryKey: scriptsKeys.list(projectId!) });
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
      },
    },
    enabled: !!projectId,
  });

  // Check if any run is currently running on initial load
  useEffect(() => {
    const runningRun = runs.find(r => r.status === 'running');
    if (runningRun && !isRunning) {
      setIsRunning(true);
      setCurrentScript(runningRun.script_name);
    } else if (!runningRun && isRunning) {
      setIsRunning(false);
    }
  }, [runs, isRunning]);

  const handleViewDetail = (run: ExecutionRun) => {
    setSelectedRunId(run.id);
  };

  const handleRunScript = (scriptId: string) => {
    setRunningScriptId(scriptId);
    runScript(scriptId, {
      onSettled: () => setRunningScriptId(null),
    });
  };

  const { data: runDetail } = useRunDetail(projectId || '', selectedRunId || '');
  const selectedRun = runDetail || runs.find(r => r.id === selectedRunId) || null;

  if (!projectId) {
    return <div>Project ID is required</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center p-4 border-b border-border-default">
        <h1 className="text-base font-medium">执行与诊断</h1>
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden p-4">
        <div className="flex-1 flex flex-col gap-4 overflow-auto">
          {timelineSteps.length > 0 && (
            <Card title="执行进度">
              <RunTimeline steps={timelineSteps} />
            </Card>
          )}

          <ExecutionControls
            projectId={projectId}
            isRunning={isRunning}
            currentScript={currentScript}
            currentStep={currentStep}
            progress={progress}
          />

          <ResultDashboard
            runs={runs}
            isLoading={isRunsLoading}
            onViewDetail={handleViewDetail}
            onRunScript={handleRunScript}
            runningScriptId={runningScriptId}
          />

          {selectedRun && (
            <RunDetail run={selectedRun} />
          )}
        </div>

        <div className="w-80 flex flex-col gap-4">
          {selectedRun && (
            <DiagnosisPanel
              projectId={projectId}
              run={selectedRun}
            />
          )}
          <ExecutionHistory runs={runs} />
        </div>
      </div>
    </div>
  );
}
