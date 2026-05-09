import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { PRDUpload } from './PRDUpload';
import { ModuleTree } from './ModuleTree';
import { ModuleDetail } from './ModuleDetail';
import { Button, Modal, Input, Card } from '@/shared/components';
import { useSSE } from '@/shared/hooks/useSSE';
import { useAIStatusStore } from '../../ai-status/store/aiStatusStore';
import {
  useModules,
  useUploadPRD,
  useAnalyzePRD,
  useCreateModule,
  useUpdateModule,
  useDeleteModule,
  useTransitionState,
  AnalysisModule
} from '../store/analysisApi';
import styles from './AnalysisPanel.module.css';

export const AnalysisPanel: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [prdContent, setPrdContent] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | undefined>();
  const [isAddL1ModalOpen, setIsAddL1ModalOpen] = useState(false);
  const [addL1Form, setAddL1Form] = useState({ name: '', description: '' });

  // API Hooks
  const { data: modules = [], refetch: refetchModules } = useModules(projectId || '');
  const uploadPRD = useUploadPRD(projectId || '');
  const analyzePRD = useAnalyzePRD(projectId || '');
  const createModule = useCreateModule(projectId || '');
  const updateModule = useUpdateModule(projectId || '');
  const deleteModule = useDeleteModule(projectId || '');
  const transitionState = useTransitionState(projectId || '');

  // AI Status Store
  const { status, setStatus, setProgress, setMessage } = useAIStatusStore();
  const isAnalyzing = status === 'running';

  // SSE Integration
  useSSE({
    url: `/api/projects/${projectId}/events`,
    events: ['prd.analysis_progress', 'prd.analysis_complete'],
    enabled: isAnalyzing && !!projectId,
    onUpdate: (event, data) => {
      if (event === 'prd.analysis_progress') {
        setProgress(data.progress || 0);
        setMessage(`${data.phase} - ${data.progress}%` || '分析中...');
      } else if (event === 'prd.analysis_complete') {
        setStatus('completed');
        setProgress(100);
        setMessage('分析完成');
        refetchModules();
      }
    },
  });

  // Find selected module
  const selectedModule = React.useMemo(() => {
    if (!selectedModuleId) return null;
    
    // Search in L1
    let found = modules.find(m => m.id === selectedModuleId);
    if (found) return found;
    
    // Search in L2
    for (const m of modules) {
      if (m.children) {
        found = m.children.find(c => c.id === selectedModuleId);
        if (found) return found;
      }
    }
    
    return null;
  }, [modules, selectedModuleId]);

  const handleAnalyze = async () => {
    if (!projectId || !prdContent.trim()) return;

    try {
      await uploadPRD.mutateAsync({ content: prdContent });
      setStatus('running');
      setProgress(0);
      setMessage('开始分析 PRD...');
      await analyzePRD.mutateAsync({ content: prdContent });
    } catch {
      setStatus('error');
      setMessage('分析失败');
    }
  };

  const handleAddL1Submit = async () => {
    if (!projectId || !addL1Form.name.trim()) return;
    
    try {
      await createModule.mutateAsync({
        name: addL1Form.name,
        description: addL1Form.description,
      });
      setIsAddL1ModalOpen(false);
      setAddL1Form({ name: '', description: '' });
    } catch {
      // Error state managed by React Query
    }
  };

  const handleAddChild = async (parentId: string, data: { name: string; description?: string }) => {
    if (!projectId) return;
    try {
      await createModule.mutateAsync({
        ...data,
        parent_id: parentId,
      });
    } catch {
      // Error state managed by React Query
    }
  };

  const handleUpdateModule = async (moduleId: string, data: { name: string; description?: string }) => {
    if (!projectId) return;
    try {
      await updateModule.mutateAsync({ moduleId, data });
    } catch {
      // Error state managed by React Query
    }
  };

  const handleDeleteModule = async (moduleId: string) => {
    if (!projectId) return;
    try {
      await deleteModule.mutateAsync(moduleId);
      if (selectedModuleId === moduleId) {
        setSelectedModuleId(undefined);
      }
    } catch {
      // Error state managed by React Query
    }
  };

  const handleConfirmComplete = async () => {
    if (!projectId) return;
    try {
      await transitionState.mutateAsync({ state: 'exploring' });
      // The parent component (ProjectPage) should handle the state change
      // typically by refetching the project or listening to SSE
    } catch {
      // Error state managed by React Query
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.topSection}>
        <PRDUpload
          content={prdContent}
          onChange={setPrdContent}
          onAnalyze={handleAnalyze}
          isAnalyzing={isAnalyzing}
        />
      </div>

      <div className={styles.mainSection}>
        <Card className={styles.leftPane} noPadding>
          <ModuleTree
            modules={modules}
            selectedModuleId={selectedModuleId}
            onSelectModule={setSelectedModuleId}
            onAddL1Module={() => setIsAddL1ModalOpen(true)}
          />
        </Card>

        <Card className={styles.rightPane} noPadding>
          <ModuleDetail
            module={selectedModule}
            onUpdate={handleUpdateModule}
            onDelete={handleDeleteModule}
            onAddChild={handleAddChild}
          />
        </Card>
      </div>

      <div className={styles.footer}>
        <Button 
          variant="primary" 
          onClick={handleConfirmComplete}
          disabled={modules.length === 0 || isAnalyzing}
        >
          确认完成，进入探索阶段
        </Button>
      </div>

      {/* Add L1 Module Modal */}
      <Modal
        isOpen={isAddL1ModalOpen}
        onClose={() => setIsAddL1ModalOpen(false)}
        title="添加 L1 模块"
      >
        <div className={styles.modalForm}>
          <Input
            label="模块名称"
            value={addL1Form.name}
            onChange={(e) => setAddL1Form({ ...addL1Form, name: e.target.value })}
            fullWidth
            autoFocus
          />
          <Input
            label="描述"
            value={addL1Form.description}
            onChange={(e) => setAddL1Form({ ...addL1Form, description: e.target.value })}
            fullWidth
          />
        </div>
        <div className={styles.modalFooter}>
          <Button variant="ghost" onClick={() => setIsAddL1ModalOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={handleAddL1Submit} disabled={!addL1Form.name.trim()}>
            添加
          </Button>
        </div>
      </Modal>
    </div>
  );
};
