import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useRuns, useRunDetail, useRunScript, executionKeys, ExecutionRun } from '../store/executionApi';
import { useSSE } from '@/hooks/use-sse.js';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
import { ExecutionControls } from './ExecutionControls';
import { ResultDashboard } from './ResultDashboard';
import { RunDetail } from './RunDetail';
import { DiagnosisPanel } from './DiagnosisPanel';
import { ExecutionHistory } from './ExecutionHistory';
import { ReportPanel } from '../../report/components/ReportPanel';

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

  const setAIStatus = useAIStatusStore(state => state.setStatus);
  const setAIMessage = useAIStatusStore(state => state.setMessage);

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
      },
      'execution.progress': (data) => {
        setCurrentStep(data.step);
        setAIMessage(`执行中: ${data.step}`);
        // Increment progress by a small amount since backend doesn't provide step index
        setProgress(prev => Math.min(prev + 5, 90));
      },
      'execution.completed': (data) => {
        setIsRunning(false);
        setCurrentScript(undefined);
        setCurrentStep(undefined);
        setProgress(100);
        setAIStatus('completed');
        setAIMessage('执行完成');
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
        // execution.completed has { run: ExecutionRun }, so access run.id
        if (selectedRunId === data.run?.id) {
          queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId!, data.run.id) });
        }
      },
      'execution.failed': (data) => {
        setIsRunning(false);
        setCurrentScript(undefined);
        setCurrentStep(undefined);
        setProgress(100);
        setAIStatus('error');
        setAIMessage(`执行失败: ${data.error}`);
        queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
        if (selectedRunId === data.runId) {
          queryClient.invalidateQueries({ queryKey: executionKeys.runDetail(projectId!, data.runId) });
        }
      },
      'ai.diagnosis': (data) => {
        queryClient.invalidateQueries({ queryKey: executionKeys.diagnosis(projectId!, data.runId) });
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
          <ExecutionControls
            projectId={projectId}
            isRunning={isRunning}
            currentScript={currentScript}
            currentStep={currentStep}
            progress={progress}
          />

          <ReportPanel projectId={projectId} />

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
