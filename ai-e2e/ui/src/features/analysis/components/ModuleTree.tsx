import React, { useMemo } from 'react';
import { Tree, TreeNodeData, Button } from '@/shared/components';
import { AnalysisModule } from '../store/analysisApi';
import { cn } from '@/lib/utils';

const sourceTagClasses: Record<string, string> = {
  ai: 'text-xs px-1.5 py-0.5 rounded bg-status-info/20 text-status-info',
  manual: 'text-xs px-1.5 py-0.5 rounded bg-surface-elevated text-text-muted',
};

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
          <div className="text-sm font-medium">
            <span>{mod.name}</span>
            {mod.source && (
              <span className={cn(
                sourceTagClasses[mod.source] ?? sourceTagClasses.manual,
              )}>
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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3">
        <div className="text-sm font-medium">模块树</div>
        <Button variant="secondary" size="sm" onClick={onAddL1Module}>
          添加 L1 模块
        </Button>
      </div>
      <div className="flex-1 overflow-auto">
        {treeData.length > 0 ? (
          <Tree
            data={treeData}
            selectedKeys={selectedModuleId ? [selectedModuleId] : []}
            onSelect={handleSelect}
          />
        ) : (
          <div className="flex items-center justify-center py-8 text-text-muted text-sm">
            暂无模块，请先分析 PRD 或手动添加
          </div>
        )}
      </div>
    </div>
  );
};
