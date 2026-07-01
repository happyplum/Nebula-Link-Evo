import React, { useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Button } from '@/shared/components';
import { AnalysisPanel } from './AnalysisPanel.js';
import { ScenarioPanel } from '../../scenario/components/ScenarioPanel.js';
import { useUploadPRD } from '../store/analysisApi.js';
import { useAgentWorkflow } from '../../agent/hooks/useAgentWorkflow.js';
import { useAgentStore } from '../../agent/store/agentStore.js';

/**
 * Wizard step "理解测试意图". Collects a natural-language test intent,
 * offers a quick PRD upload shortcut, and renders the existing analysis
 * and scenario panels below. The natural-language prompt is displayed in
 * a preview card and forwarded to the agent workflow (opens AgentChat).
 */
export const UnderstandStep: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadPRD = useUploadPRD(projectId || '');
  const { send } = useAgentWorkflow(projectId || '');
  const { setOpen } = useAgentStore();

  const handleGenerate = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setLastPrompt(trimmed);
    setOpen(true);
    send(trimmed);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !projectId) return;
    setUploadError(null);
    try {
      const text = await file.text();
      await uploadPRD.mutateAsync({ content: text });
    } catch {
      setUploadError('PRD 上传失败，请重试');
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleNext = () => {
    const next = new URLSearchParams(searchParams);
    next.set('step', 'explore');
    setSearchParams(next, { replace: false });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Step header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-text-primary">理解测试意图</h2>
        <Button variant="ghost" size="sm" onClick={handleNext}>
          下一步
        </Button>
      </div>

      {/* Natural-language prompt input */}
      <div className="rounded-lg border border-border-default bg-surface-elevated p-4">
        <label
          htmlFor="understand-prompt"
          className="mb-2 block text-sm font-medium text-text-primary"
        >
          用一句话描述你想测试什么
        </label>
        <textarea
          id="understand-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="用一句话描述你想测试什么…"
          rows={3}
          className="w-full resize-none rounded-md border border-border-default bg-surface-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-status-info focus:outline-none"
        />
        <div className="mt-3 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            disabled={!prompt.trim()}
          >
            生成分析
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleUploadClick}
            disabled={uploadPRD.isPending || !projectId}
            title={!projectId ? '需要先选择项目' : undefined}
          >
            {uploadPRD.isPending ? '上传中...' : '上传 PRD'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            className="hidden"
            onChange={handleFileChange}
          />
          {uploadError && (
            <span className="text-xs text-status-error">{uploadError}</span>
          )}
        </div>
      </div>

      {/* Prompt preview card (also forwarded to the agent workflow) */}
      {lastPrompt && (
        <div
          data-testid="prompt-preview"
          className="rounded-lg border border-status-info/30 bg-status-info/10 px-4 py-3"
        >
          <div className="text-xs text-text-secondary">测试需求预览</div>
          <div className="mt-1 text-sm text-text-primary">{lastPrompt}</div>
        </div>
      )}

      {/* Existing analysis + scenario panels */}
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <AnalysisPanel />
        </div>
        <div className="w-full shrink-0 lg:w-[360px]">
          <ScenarioPanel />
        </div>
      </div>
    </div>
  );
};
