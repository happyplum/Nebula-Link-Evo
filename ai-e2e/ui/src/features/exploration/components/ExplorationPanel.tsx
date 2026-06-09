import React, { useState, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { ExplorationControls } from './ExplorationControls';
import { URLList } from './URLList';
import { PagePreview } from './PagePreview';
import { BindingEditor } from './BindingEditor';
import { UnboundModuleIndicator } from './UnboundModuleIndicator';
import { Button, Modal, Input, Card } from '@/shared/components';
import { useSSE } from '@/hooks/use-sse.js';
import { createAIStatusStore } from '../../ai-status/store/aiStatusStore';
import {
  useExplorationStatus,
  useUrls,
  useBindings,
  useStartExploration,
  useStopExploration,
  useAddUrl,
  useProposeBindings,
  useConfirmBinding,
  useRejectBinding,
  useTransitionState,
  ModuleBinding,
  explorationKeys
} from '../store/explorationApi';
import { useQueryClient } from '@tanstack/react-query';

export const ExplorationPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  
  const [selectedUrlId, setSelectedUrlId] = useState<string | undefined>();
  const [isAddUrlModalOpen, setIsAddUrlModalOpen] = useState(false);
  const [addUrlForm, setAddUrlForm] = useState({ url: '', title: '' });
  const [unboundModuleDetails, setUnboundModuleDetails] = useState<string[]>([]);

  // API Hooks
  const { data: statusData, refetch: refetchStatus, isLoading: isStatusLoading, error: statusError } = useExplorationStatus(projectId || '');
  const { data: urls = [], isLoading: isUrlsLoading, error: urlsError, refetch: refetchUrls } = useUrls(projectId || '');
  const { data: bindings = [], isLoading: isBindingsLoading, error: bindingsError } = useBindings(projectId || '');

  const startExploration = useStartExploration(projectId || '');
  const stopExploration = useStopExploration(projectId || '');
  const addUrl = useAddUrl(projectId || '');
  const proposeBindings = useProposeBindings(projectId || '');
  const confirmBinding = useConfirmBinding(projectId || '');
  const rejectBinding = useRejectBinding(projectId || '');
  const transitionState = useTransitionState(projectId || '');

  // AI Status Store (lazy init)
  const usePanelAIStatus = useRef(createAIStatusStore()).current;
  const { status, setStatus, setProgress, setMessage } = usePanelAIStatus();
  const isExploring = status === 'running' || statusData?.status === 'running';

  // SSE Integration
  useSSE({
    projectId: projectId || '',
    handlers: {
      'exploration.progress': (data) => {
        // Progress based on pages visited relative to URLs found
        const progress = data.urlsFound > 0 ? (data.pagesVisited / data.urlsFound) * 100 : 0;
        setProgress(Math.min(progress, 100));
        setMessage(`正在探索: 已访问 ${data.pagesVisited} 页`);
        refetchStatus();
      },
      'exploration.url_found': () => {
        refetchUrls();
      },
      'exploration.binding_proposed': () => {
        // Invalidate bindings query to refetch
        queryClient.invalidateQueries({ queryKey: explorationKeys.bindings(projectId || '') });
      },
      'exploration.complete': () => {
        setStatus('completed');
        setProgress(100);
        setMessage('探索完成');
        refetchStatus();
        refetchUrls();
      },
    },
    enabled: !!projectId,
  });

  const isDataLoading = isStatusLoading || isUrlsLoading || isBindingsLoading;
  const dataError = statusError || urlsError || bindingsError;

  if (isDataLoading) {
    return <div className="flex items-center justify-center p-8"><span className="text-text-muted">加载中...</span></div>;
  }
  if (dataError) {
    return <div className="p-4 text-status-error">加载失败</div>;
  }

  const selectedUrl = useMemo(() => {
    return urls.find(u => u.id === selectedUrlId) || null;
  }, [urls, selectedUrlId]);

  const handleStart = async () => {
    if (!projectId) return;
    try {
      setStatus('running');
      setProgress(0);
      setMessage('准备开始探索...');
      await startExploration.mutateAsync({});
    } catch {
      setStatus('error');
      setMessage('启动探索失败');
    }
  };

  const handleStop = async () => {
    if (!projectId) return;
    try {
      await stopExploration.mutateAsync();
      setStatus('paused');
      setMessage('探索已停止');
    } catch {
      // Error state managed by React Query
    }
  };

  const handleAddUrlSubmit = async () => {
    if (!projectId || !addUrlForm.url.trim()) return;
    try {
      await addUrl.mutateAsync({
        url: addUrlForm.url,
        title: addUrlForm.title,
      });
      setIsAddUrlModalOpen(false);
      setAddUrlForm({ url: '', title: '' });
    } catch {
      // Error state managed by React Query
    }
  };

  const handleConfirmComplete = async () => {
    if (!projectId) return;
    setUnboundModuleDetails([]);
    try {
      await transitionState.mutateAsync({ targetStatus: 'generating' });
    } catch (error: any) {
      if (error?.code === 'DELIVERABLES_NOT_MET' && Array.isArray(error.details)) {
        setUnboundModuleDetails(error.details);
      }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-4">
        <ExplorationControls
          isExploring={isExploring}
          progress={statusData?.pages_visited ? Math.min(statusData.pages_visited, 100) : 0}
          message={statusData?.current_url || null}
          pagesVisited={statusData?.pages_visited || 0}
          urlsFound={statusData?.urls_found || urls.length}
          onStart={handleStart}
          onStop={handleStop}
        />
      </div>

      <div className="flex-1 flex gap-4 overflow-hidden">
        <Card className="w-1/2 flex flex-col" noPadding>
          <URLList
            urls={urls}
            selectedUrlId={selectedUrlId}
            onSelectUrl={(url) => setSelectedUrlId(url.id)}
            onAddManualUrl={() => setIsAddUrlModalOpen(true)}
          />
        </Card>

        <Card className="w-1/2 flex flex-col" noPadding>
          <PagePreview url={selectedUrl} />
        </Card>
      </div>

      <div>
        {unboundModuleDetails.length > 0 && (
          <UnboundModuleIndicator 
            details={unboundModuleDetails} 
            onDismiss={() => setUnboundModuleDetails([])} 
          />
        )}
        <BindingEditor
          bindings={bindings as ModuleBinding[]}
          onProposeBindings={(data) => proposeBindings.mutate(data)}
          onConfirmBinding={(id) => confirmBinding.mutate(id)}
          onRejectBinding={(id) => rejectBinding.mutate(id)}
          isProposing={proposeBindings.isPending}
        />
      </div>

      <div className="flex gap-2 justify-end">
        <Button 
          variant="primary" 
          onClick={handleConfirmComplete}
          disabled={isExploring || urls.length === 0 || transitionState.isPending}
          isLoading={transitionState.isPending}
        >
          确认完成，进入生成阶段
        </Button>
      </div>

      {/* Add URL Modal */}
      <Modal
        isOpen={isAddUrlModalOpen}
        onClose={() => setIsAddUrlModalOpen(false)}
        title="手动添加 URL"
      >
        <div className="space-y-4">
          <Input
            label="URL 地址"
            value={addUrlForm.url}
            onChange={(e) => setAddUrlForm({ ...addUrlForm, url: e.target.value })}
            placeholder="https://example.com"
            fullWidth
            autoFocus
          />
          <Input
            label="页面标题 (可选)"
            value={addUrlForm.title}
            onChange={(e) => setAddUrlForm({ ...addUrlForm, title: e.target.value })}
            placeholder="例如：登录页"
            fullWidth
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" onClick={() => setIsAddUrlModalOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={handleAddUrlSubmit} disabled={!addUrlForm.url.trim()}>
            添加
          </Button>
        </div>
      </Modal>
    </div>
  );
};

export default ExplorationPanel;
