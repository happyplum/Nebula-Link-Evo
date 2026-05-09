import React, { useState, useEffect } from 'react';
import { Button, Input, Modal } from '@/shared/components';
import { AnalysisModule } from '../store/analysisApi';
import styles from './ModuleDetail.module.css';

export interface ModuleDetailProps {
  module: AnalysisModule | null;
  onUpdate: (moduleId: string, data: { name: string; description?: string }) => void;
  onDelete: (moduleId: string) => void;
  onAddChild: (parentId: string, data: { name: string; description?: string }) => void;
}

export const ModuleDetail: React.FC<ModuleDetailProps> = ({
  module,
  onUpdate,
  onDelete,
  onAddChild,
}) => {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddChildModalOpen, setIsAddChildModalOpen] = useState(false);
  
  const [editForm, setEditForm] = useState({ name: '', description: '' });
  const [addForm, setAddForm] = useState({ name: '', description: '' });
  const [editingChildId, setEditingChildId] = useState<string | null>(null);

  useEffect(() => {
    if (module && isEditModalOpen && !editingChildId) {
      setEditForm({
        name: module.name,
        description: module.description || '',
      });
    }
  }, [module, isEditModalOpen, editingChildId]);

  if (!module) {
    return (
      <div className={styles.container}>
        <div className={styles.emptyState}>
          请在左侧选择一个模块查看详情
        </div>
      </div>
    );
  }

  const handleEditSubmit = () => {
    if (!editForm.name.trim()) return;
    
    if (editingChildId) {
      onUpdate(editingChildId, editForm);
    } else {
      onUpdate(module.id, editForm);
    }
    
    setIsEditModalOpen(false);
    setEditingChildId(null);
  };

  const handleAddChildSubmit = () => {
    if (!addForm.name.trim()) return;
    onAddChild(module.id, addForm);
    setIsAddChildModalOpen(false);
    setAddForm({ name: '', description: '' });
  };

  const openEditChild = (child: AnalysisModule) => {
    setEditingChildId(child.id);
    setEditForm({
      name: child.name,
      description: child.description || '',
    });
    setIsEditModalOpen(true);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>模块详情</div>
        <div className={styles.actions}>
          <Button 
            variant="secondary" 
            size="sm" 
            onClick={() => {
              setEditingChildId(null);
              setIsEditModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Button 
            variant="danger" 
            size="sm" 
            onClick={() => {
              if (window.confirm('确定要删除此模块吗？')) {
                onDelete(module.id);
              }
            }}
          >
            删除
          </Button>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.infoSection}>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>模块名称</span>
            <span className={styles.infoValue}>{module.name}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>描述</span>
            <span className={styles.infoValue}>{module.description || '暂无描述'}</span>
          </div>
          <div className={styles.infoRow}>
            <span className={styles.infoLabel}>来源</span>
            <span className={styles.infoValue}>{module.source === 'ai' ? 'AI 生成' : '手动添加'}</span>
          </div>
        </div>

        <div className={styles.childrenSection}>
          <div className={styles.childrenHeader}>
            <div className={styles.childrenTitle}>子模块 (L2)</div>
            <Button 
              variant="secondary" 
              size="sm" 
              onClick={() => {
                setAddForm({ name: '', description: '' });
                setIsAddChildModalOpen(true);
              }}
            >
              添加子模块
            </Button>
          </div>

          <div className={styles.childList}>
            {module.children && module.children.length > 0 ? (
              module.children.map(child => (
                <div key={child.id} className={styles.childItem}>
                  <div className={styles.childInfo}>
                    <span className={styles.childName}>{child.name}</span>
                    {child.description && (
                      <span className={styles.childDesc}>{child.description}</span>
                    )}
                  </div>
                  <div className={styles.childActions}>
                    <Button variant="ghost" size="sm" onClick={() => openEditChild(child)}>
                      编辑
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => {
                        if (window.confirm('确定要删除此子模块吗？')) {
                          onDelete(child.id);
                        }
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.emptyState} style={{ height: '100px' }}>
                暂无子模块
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditingChildId(null);
        }}
        title={editingChildId ? "编辑子模块" : "编辑模块"}
      >
        <div className={styles.modalForm}>
          <Input
            label="模块名称"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            fullWidth
            autoFocus
          />
          <Input
            label="描述"
            value={editForm.description}
            onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
            fullWidth
          />
        </div>
        <div className={styles.modalFooter}>
          <Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={handleEditSubmit} disabled={!editForm.name.trim()}>
            保存
          </Button>
        </div>
      </Modal>

      {/* Add Child Modal */}
      <Modal
        isOpen={isAddChildModalOpen}
        onClose={() => setIsAddChildModalOpen(false)}
        title="添加子模块"
      >
        <div className={styles.modalForm}>
          <Input
            label="模块名称"
            value={addForm.name}
            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
            fullWidth
            autoFocus
          />
          <Input
            label="描述"
            value={addForm.description}
            onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
            fullWidth
          />
        </div>
        <div className={styles.modalFooter}>
          <Button variant="ghost" onClick={() => setIsAddChildModalOpen(false)}>
            取消
          </Button>
          <Button variant="primary" onClick={handleAddChildSubmit} disabled={!addForm.name.trim()}>
            添加
          </Button>
        </div>
      </Modal>
    </div>
  );
};
