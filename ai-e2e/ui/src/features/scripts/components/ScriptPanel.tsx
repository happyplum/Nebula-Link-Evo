import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Button, Card } from '@/shared/components';
import { useSSE } from '@/shared/hooks/useSSE';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
import { useScripts, useGenerateScripts, useTransitionState, Script } from '../store/scriptsApi';
import { ScriptList } from './ScriptList';
import { ScriptEditor } from './ScriptEditor';
import { TestDataEditor } from './TestDataEditor';
import { VersionHistory } from './VersionHistory';
import styles from './ScriptPanel.module.css';

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

  // Listen to SSE events for script generation
  useSSE({
    url: `/api/projects/${projectId}/events`,
    events: ['script.generation_progress', 'script.generated'],
    enabled: !!projectId,
    onUpdate: (event, data) => {
      if (event === 'script.generation_progress' || event === 'script.generated') {
        refetchScripts();
      }
    }
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
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2>脚本生成与编辑</h2>
          <p className={styles.subtitle}>生成并编辑 Playwright 测试脚本</p>
        </div>
        <div className={styles.actions}>
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
        <Card className={styles.progressCard}>
          <div className={styles.progressHeader}>
            <span>AI 正在生成脚本...</span>
            <span>{aiProgress}%</span>
          </div>
          <div className={styles.progressBar}>
            <div 
              className={styles.progressFill} 
              style={{ width: `${aiProgress}%` }} 
            />
          </div>
          {aiMessage && <div className={styles.progressMessage}>{aiMessage}</div>}
        </Card>
      )}

      <div className={styles.content}>
        <div className={styles.sidebar}>
          <ScriptList 
            scripts={scripts} 
            selectedId={selectedScriptId} 
            onSelect={setSelectedScriptId} 
          />
        </div>
        
        <div className={styles.main}>
          {selectedScript ? (
            <Card className={styles.editorCard} noPadding>
              <div className={styles.tabs}>
                <button 
                  className={`${styles.tab} ${activeTab === 'editor' ? styles.activeTab : ''}`}
                  onClick={() => setActiveTab('editor')}
                >
                  代码编辑
                </button>
                <button 
                  className={`${styles.tab} ${activeTab === 'testData' ? styles.activeTab : ''}`}
                  onClick={() => setActiveTab('testData')}
                >
                  测试数据
                </button>
                <button 
                  className={`${styles.tab} ${activeTab === 'history' ? styles.activeTab : ''}`}
                  onClick={() => setActiveTab('history')}
                >
                  版本历史
                </button>
              </div>
              
              <div className={styles.tabContent}>
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
            <div className={styles.emptyState}>
              <p>请在左侧选择一个脚本进行编辑</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
