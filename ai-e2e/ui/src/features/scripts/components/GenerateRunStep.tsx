import React from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '@/shared/components';
import { useGenerateScripts } from '../store/scriptsApi.js';
import { useRunAllScripts } from '../../execution/store/executionApi.js';
import ScriptPanel from './ScriptPanel.js';
import ExecutionPanel from '../../execution/components/ExecutionPanel.js';
import { ReportPanel } from '../../report/components/ReportPanel.js';

/**
 * Wizard "run" step: generate scripts, run them all, then inspect the
 * results. Reuses the existing ScriptPanel / ExecutionPanel / ReportPanel
 * unchanged; this component only adds the step header and quick-action
 * buttons that drive the underlying API hooks.
 */
export const GenerateRunStep: React.FC = () => {
  const { projectId = '' } = useParams<{ projectId: string }>();

  const { mutate: generateScripts, isPending: isGenerating } =
    useGenerateScripts(projectId);
  const { mutate: runAllScripts, isPending: isRunningAll } =
    useRunAllScripts(projectId);

  const handleGenerate = () => generateScripts();
  const handleRunAll = () => runAllScripts();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">生成与执行</h2>
          <p className="text-sm text-text-secondary">
            生成 Playwright 脚本并执行全部测试
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={isGenerating || isRunningAll}
          >
            生成脚本
          </Button>
          <Button
            variant="primary"
            onClick={handleRunAll}
            isLoading={isRunningAll}
            disabled={isGenerating || isRunningAll}
          >
            执行全部脚本
          </Button>
        </div>
      </div>

      <ScriptPanel />
      <ExecutionPanel />
      <ReportPanel projectId={projectId} />
    </div>
  );
};

export default GenerateRunStep;
