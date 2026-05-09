import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useRuns, useRunScript, executionKeys, ExecutionRun } from '../store/executionApi';
import { useSSE } from '@/shared/hooks/useSSE';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
import { ExecutionControls } from './ExecutionControls';
import { ResultDashboard } from './ResultDashboard';
import { RunDetail } from './RunDetail';
import { DiagnosisPanel } from './DiagnosisPanel';
import { ExecutionHistory } from './ExecutionHistory';
import styles from './ExecutionPanel.module.css';

export default function ExecutionPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  
  const { data: runs = [], isLoading: isRunsLoading } = useRuns(projectId || '');
  const { mutate: runScript } = useRunScript(projectId || '');
  
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [currentScript, setCurrentScript] = useState<string>();
  const [currentStep, setCurrentStep] = useState<string>();
  const [progress, setProgress] = useState(0);

  const setAIStatus = useAIStatusStore(state => state.setStatus);
  const setAIMessage = useAIStatusStore(state => state.setMessage);

  // SSE Connection
  useSSE({
    url: `/api/projects/${projectId}/events`,
    events: ['execution.started', 'execution.progress', 'execution.completed', 'execution.failed', 'ai.diagnosis'],
    enabled: !!projectId,
    onUpdate: (event, data) => {
      switch (event) {
        case 'execution.started':
          setIsRunning(true);
          setCurrentScript(data.scriptId);
          setCurrentStep('初始化...');
          setProgress(0);
          setAIStatus('running');
          setAIMessage(`开始执行脚本: ${data.scriptId}`);
          queryClient.invalidateQueries({ queryKey: executionKeys.runs(projectId!) });
          break;
        case 'execution.progress':
          setCurrentStep(data.step);
          setAIMessage(`执行中: ${data.step}`);
          // Increment progress by a small amount since backend doesn't provide step index
          setProgress(prev => Math.min(prev + 5, 90));
          break;
        case 'execution.completed':
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
          break;
        case 'execution.failed':
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
          break;
        case 'ai.diagnosis':
          queryClient.invalidateQueries({ queryKey: executionKeys.diagnosis(projectId!, data.runId) });
          break;
      }
    },
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
    runScript(scriptId);
  };

  const selectedRun = runs.find(r => r.id === selectedRunId);

  if (!projectId) {
    return <div>Project ID is required</div>;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1 className={styles.title}>执行与诊断</h1>
      </div>

      <div className={styles.content}>
        <div className={styles.mainColumn}>
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
          />

          {selectedRun && (
            <RunDetail run={selectedRun} />
          )}
        </div>

        <div className={styles.sideColumn}>
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
