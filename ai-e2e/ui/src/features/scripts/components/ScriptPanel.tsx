import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card } from '@/shared/components';
import { useSSE } from '@/hooks/use-sse.js';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
import { useScripts, useGenerateScripts, useTransitionState, Script } from '../store/scriptsApi';
import { ScriptList } from './ScriptList';
import { ScriptEditor } from './ScriptEditor';
import { TestDataEditor } from './TestDataEditor';
import { VersionHistory } from './VersionHistory';
import { cn } from '@/lib/utils';

export default function ScriptPanel() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'editor' | 'testData' | 'history'>('editor');
  
  const { data: scripts = [], refetch: refetchScripts } = useScripts(projectId!);
  const { mutate: generateScripts, isPending: isGenerating } = useGenerateScripts(projectId!);
  const { mutate: transitionState, isPending: isTransitioning } = useTransitionState(projectId!);
  
  const aiStatus = useAIStatusStore((state) => state.status);
  const aiProgress = useAIStatusStore((state) => state.progress);
  const aiMessage = useAIStatusStore((state) => state.message);

  const setAIStatus = useAIStatusStore((state) => state.setStatus);
  const setAIProgress = useAIStatusStore((state) => state.setProgress);

  // Listen to SSE events for script generation
  useSSE({
    projectId: projectId || '',
    handlers: {
      'script.generation_progress': (data) => {
        setAIStatus('running');
        if (data.progress != null) setAIProgress(data.progress);
        refetchScripts();
      },
      'script.generated': () => {
        setAIStatus('completed');
        setAIProgress(100);
        refetchScripts();
      },
    },
    enabled: !!projectId,
  });

  const handleGenerate = () => {
    if (projectId) {
      generateScripts();
    }
  };

  const handleComplete = () => {
    if (projectId) {
      transitionState({ targetStatus: 'ready' });
    }
  };

  const selectedScript = scripts.find(s => s.id === selectedScriptId) || null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-default p-4">
        <div>
          <h2>脚本生成与编辑</h2>
          <p className="text-sm text-text-muted">生成并编辑 Playwright 测试脚本</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="secondary" 
            onClick={handleGenerate}
            isLoading={isGenerating || aiStatus === 'running'}
            disabled={aiStatus === 'running'}
          >
            {aiStatus === 'running' ? '生成中...' : '生成脚本'}
          </Button>
          <Button 
            variant="primary" 
            onClick={handleComplete}
            isLoading={isTransitioning}
          >
            确认完成
          </Button>
        </div>
      </div>

      {aiStatus === 'running' && (
        <Card className="mb-4 border border-border-default bg-surface-content p-4">
          <div className="mb-2 flex items-center justify-between">
            <span>AI 正在生成脚本...</span>
            <span>{aiProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-elevated">
            <div 
              className="h-full rounded-full bg-status-info" 
              style={{ width: `${aiProgress}%` }} 
            />
          </div>
          {aiMessage && <div className="mt-2 text-sm text-text-secondary">{aiMessage}</div>}
        </Card>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 overflow-auto border-r border-border-default">
          <ScriptList 
            scripts={scripts} 
            selectedId={selectedScriptId} 
            onSelect={setSelectedScriptId} 
          />
        </div>
        
        <div className="flex flex-1 flex-col">
          {selectedScript ? (
            <Card className="flex flex-1 flex-col" noPadding>
              <div className="flex border-b border-border-default">
                <button 
                  className={cn(
                    'cursor-pointer px-4 py-2 text-sm',
                    activeTab === 'editor' && 'border-b-2 border-status-info text-text-primary'
                  )}
                  onClick={() => setActiveTab('editor')}
                >
                  代码编辑
                </button>
                <button 
                  className={cn(
                    'cursor-pointer px-4 py-2 text-sm',
                    activeTab === 'testData' && 'border-b-2 border-status-info text-text-primary'
                  )}
                  onClick={() => setActiveTab('testData')}
                >
                  测试数据
                </button>
                <button 
                  className={cn(
                    'cursor-pointer px-4 py-2 text-sm',
                    activeTab === 'history' && 'border-b-2 border-status-info text-text-primary'
                  )}
                  onClick={() => setActiveTab('history')}
                >
                  版本历史
                </button>
              </div>
              
              <div className="flex-1 overflow-auto">
                {activeTab === 'editor' && (
                  <ScriptEditor projectId={projectId!} script={selectedScript} />
                )}
                {activeTab === 'testData' && (
                  <TestDataEditor projectId={projectId!} script={selectedScript} />
                )}
                {activeTab === 'history' && (
                  <VersionHistory projectId={projectId!} script={selectedScript} />
                )}
              </div>
            </Card>
          ) : (
            <div className="flex h-full items-center justify-center text-text-muted">
              <p>请在左侧选择一个脚本进行编辑</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
