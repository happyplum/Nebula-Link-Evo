import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Script } from '../store/scriptsApi';

interface ScriptListProps {
  scripts: Script[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface GroupedScripts {
  [businessModule: string]: {
    [functionalModule: string]: Script[];
  };
}

export const ScriptList: React.FC<ScriptListProps> = ({ scripts, selectedId, onSelect }) => {
  const groupedScripts = useMemo(() => {
    const groups: GroupedScripts = {};
    
    scripts.forEach(script => {
      const bName = script.business_module_name || '未分类业务模块';
      const fName = script.functional_module_name || '未分类功能模块';
      
      if (!groups[bName]) {
        groups[bName] = {};
      }
      if (!groups[bName][fName]) {
        groups[bName][fName] = [];
      }
      
      groups[bName][fName].push(script);
    });
    
    return groups;
  }, [scripts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready': return 'bg-status-success';
      case 'failed': return 'bg-status-error';
      case 'draft': return 'bg-status-warning';
      default: return 'bg-text-muted';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready': return '就绪';
      case 'failed': return '失败';
      case 'draft': return '草稿';
      default: return '未知';
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between p-3">
        <h3>脚本列表</h3>
        <span className="text-xs text-text-muted">共 {scripts.length} 个</span>
      </div>
      
      <div className="flex-1 overflow-auto">
        {Object.entries(groupedScripts).map(([bName, fModules]) => (
          <div key={bName} className="mb-2">
            <div className="px-3 py-1.5 text-xs font-medium uppercase tracking-wider text-text-muted">
              {bName}
            </div>
            
            {Object.entries(fModules).map(([fName, moduleScripts]) => (
              <div key={fName}>
                <div className="px-3 py-1 text-xs font-medium text-text-secondary">
                  {fName}
                </div>
                
                <div>
                  {moduleScripts.map(script => (
                    <div 
                      key={script.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-surface-elevated',
                        selectedId === script.id && 'bg-accent'
                      )}
                      onClick={() => onSelect(script.id)}
                    >
                      <div className="min-w-0 flex-1">
                        <span className="truncate text-sm">{script.scenario_name}</span>
                      </div>
                      <span 
                        className={cn('h-2 w-2 rounded-full', getStatusColor(script.status))}
                        title={getStatusText(script.status)}
                      />
                      <div className="flex items-center gap-2 text-xs text-text-muted">
                        <span>v{script.version}</span>
                        <span>
                          {script.generated_by === 'ai_generated' ? 'AI 生成' : 
                           script.generated_by === 'human_edited' ? '人工编辑' : 'AI 修复'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        
        {scripts.length === 0 && (
          <div className="flex items-center justify-center py-8 text-sm text-text-muted">暂无脚本</div>
        )}
      </div>
    </div>
  );
};
