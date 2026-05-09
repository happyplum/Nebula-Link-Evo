import React, { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ExplorationControls } from './ExplorationControls';
import { URLList } from './URLList';
import { PagePreview } from './PagePreview';
import { BindingEditor } from './BindingEditor';
import { Button, Modal, Input, Card } from '@/shared/components';
import { useSSE } from '@/shared/hooks/useSSE';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
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
import styles from './ExplorationPanel.module.css';

export const ExplorationPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  
  const [selectedUrlId, setSelectedUrlId] = useState<string | undefined>();
  const [isAddUrlModalOpen, setIsAddUrlModalOpen] = useState(false);
  const [addUrlForm, setAddUrlForm] = useState({ url: '', title: '' });

  // API Hooks
  const { data: statusData, refetch: refetchStatus } = useExplorationStatus(projectId || '');
  const { data: urls = [], refetch: refetchUrls } = useUrls(projectId || '');
  const { data: bindings = [] } = useBindings(projectId || '');

  const startExploration = useStartExploration(projectId || '');
  const stopExploration = useStopExploration(projectId || '');
  const addUrl = useAddUrl(projectId || '');
  const proposeBindings = useProposeBindings(projectId || '');
  const confirmBinding = useConfirmBinding(projectId || '');
  const rejectBinding = useRejectBinding(projectId || '');
  const transitionState = useTransitionState(projectId || '');

  // AI Status Store
  const { status, setStatus, setProgress, setMessage } = useAIStatusStore();
  const isExploring = status === 'running' || statusData?.status === 'running';

  // SSE Integration
  useSSE({
    url: `/api/projects/${projectId}/events`,
    events: ['exploration.progress', 'exploration.url_found', 'exploration.binding_proposed', 'exploration.complete'],
    enabled: !!projectId,
      onUpdate: (event, data) => {
      if (event === 'exploration.progress') {
        // Progress based on pages visited relative to URLs found
        const progress = data.urlsFound > 0 ? (data.pagesVisited / data.urlsFound) * 100 : 0;
        setProgress(Math.min(progress, 100));
        setMessage(`正在探索: 已访问 ${data.pagesVisited} 页`);
        refetchStatus();
      } else if (event === 'exploration.url_found') {
        refetchUrls();
      } else if (event === 'exploration.binding_proposed') {
        // Invalidate bindings query to refetch
        queryClient.invalidateQueries({ queryKey: explorationKeys.bindings(projectId || '') });
      } else if (event === 'exploration.complete') {
        setStatus('completed');
        setProgress(100);
        setMessage('探索完成');
        refetchStatus();
        refetchUrls();
      }
    },
  });

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
    try {
      await transitionState.mutateAsync({ state: 'generating' });
    } catch {
      // Error state managed by React Query
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.topSection}>
        <ExplorationControls
          isExploring={isExploring}
          progress={statusData?.pages_visited ? (statusData.pages_visited / 100) * 100 : 0} // Assuming max 100 for now
          message={statusData?.current_url || null}
          pagesVisited={statusData?.pages_visited || 0}
          urlsFound={statusData?.urls_found || urls.length}
          onStart={handleStart}
          onStop={handleStop}
        />
      </div>

      <div className={styles.mainSection}>
        <Card className={styles.leftPane} noPadding>
          <URLList
            urls={urls}
            selectedUrlId={selectedUrlId}
            onSelectUrl={(url) => setSelectedUrlId(url.id)}
            onAddManualUrl={() => setIsAddUrlModalOpen(true)}
          />
        </Card>

        <Card className={styles.rightPane} noPadding>
          <PagePreview url={selectedUrl} />
        </Card>
      </div>

      <div className={styles.bottomSection}>
        <BindingEditor
          bindings={bindings as ModuleBinding[]}
          onProposeBindings={() => proposeBindings.mutate()}
          onConfirmBinding={(id) => confirmBinding.mutate(id)}
          onRejectBinding={(id) => rejectBinding.mutate(id)}
          isProposing={proposeBindings.isPending}
        />
      </div>

      <div className={styles.footer}>
        <Button 
          variant="primary" 
          onClick={handleConfirmComplete}
          disabled={isExploring || urls.length === 0}
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
        <div className={styles.modalForm}>
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
        <div className={styles.modalFooter}>
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
