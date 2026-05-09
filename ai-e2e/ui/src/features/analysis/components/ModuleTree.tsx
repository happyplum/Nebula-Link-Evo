import React, { useMemo } from 'react';
import { Tree, TreeNodeData, Button } from '@/shared/components';
import { AnalysisModule } from '../store/analysisApi';
import styles from './ModuleTree.module.css';

export interface ModuleTreeProps {
  modules: AnalysisModule[];
  selectedModuleId?: string;
  onSelectModule: (moduleId: string) => void;
  onAddL1Module: () => void;
}

export const ModuleTree: React.FC<ModuleTreeProps> = ({
  modules,
  selectedModuleId,
  onSelectModule,
  onAddL1Module,
}) => {
  const treeData = useMemo(() => {
    const buildTree = (mods: AnalysisModule[]): TreeNodeData[] => {
      return mods.map((mod) => ({
        key: mod.id,
        title: (
          <div className={styles.nodeTitle}>
            <span>{mod.name}</span>
            {mod.source && (
              <span className={`${styles.sourceTag} ${mod.source === 'ai' ? styles.sourceTagAi : ''}`}>
                {mod.source === 'ai' ? 'AI' : '手动'}
              </span>
            )}
          </div>
        ),
        children: mod.children ? buildTree(mod.children) : undefined,
        isLeaf: !mod.children || mod.children.length === 0,
      }));
    };
    return buildTree(modules);
  }, [modules]);

  const handleSelect = (selectedKeys: string[]) => {
    if (selectedKeys.length > 0) {
      onSelectModule(selectedKeys[0]);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.title}>模块树</div>
        <Button variant="secondary" size="sm" onClick={onAddL1Module}>
          添加 L1 模块
        </Button>
      </div>
      <div className={styles.treeContainer}>
        {treeData.length > 0 ? (
          <Tree
            data={treeData}
            selectedKeys={selectedModuleId ? [selectedModuleId] : []}
            onSelect={handleSelect}
          />
        ) : (
          <div className={styles.emptyState}>
            暂无模块，请先分析 PRD 或手动添加
          </div>
        )}
      </div>
    </div>
  );
};
